import { z } from "zod";
import { jsonError } from "@/lib/http";
import { safeFileNameStem } from "@/lib/sharing/share-images";
import { requireUser } from "@/lib/supabase/auth";
import { fetchStreaming, fetchWithTimeout } from "@/lib/video/fetch";
import { isRetriableDownloadStatus } from "@/lib/video/playback";
import { isWellFormedRange, parseByteRange } from "@/lib/video/range";
import { findVideoAsset, persistVideoAsset, signVideoAsset } from "@/lib/video/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 签名地址只在这一跳里用掉，60 秒足够服务端把请求发出去。 */
const SIGNED_URL_TTL_SECONDS = 60;
/**
 * 只用来取元数据与探测可达性的这一跳的时间上限。
 *
 * 注意**不要**给转发响应体的那一跳加超时：见 fetchStreaming 的说明 ——
 * 带 signal 的 fetch 一旦超时会直接销毁流，慢速客户端会拿到被静默截断的视频。
 */
const PROBE_TIMEOUT_MS = 30_000;

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

type JobRow = { id: string; status: string; output_url: string | null };

/**
 * 文件名提示，同时给出 ASCII 回退名与 UTF-8 真名。
 *
 * 用 `inline` 而不是 `attachment`：这条接口同时是 <video> 的播放源，
 * `attachment` 在部分浏览器里会让视频变成下载而不是播放。两种用法都不依赖
 * 这个头 —— 下载走的是前端 `fetch` 成 Blob + objectURL，这里的 filename
 * 只是给用户一个好认的文件名。
 */
function contentDisposition(fileName: string) {
  // ASCII 回退名里不能出现双引号或反斜杠，`filename*` 才是真正生效的那个（RFC 5987）。
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "video.mp4";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * 下载已生成的视频。
 *
 * 为什么必须走服务端代理，而不是让前端对签名地址直接 `<a download>`：
 * 视频存在**私有** bucket，前端拿到的永远是跨域且一小时就过期的签名地址 ——
 * 跨域时 `download` 属性被浏览器忽略，过期后连点开都是 403。用户看到的现象就是
 * 「能在线播放，但下载不了」。
 *
 * 这里只做「取地址 → 转发字节」，**绝不重新调用视频 Provider**，不产生任何计费。
 *
 * 同时支持 Range：iOS 上所有浏览器的 <video> 都会先发 `Range: bytes=0-1` 探测，
 * 只有 206 才肯播放。这条接口既是下载入口，也是发布助手的视频预览源。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "视频任务 ID 无效。" }, { status: 400 });
    }

    const { user, supabase } = await requireUser();
    const job = await supabase
      .from("video_jobs")
      .select("id,status,output_url")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (job.error) throw job.error;
    if (!job.data) return Response.json({ error: "视频任务不存在或无权访问。" }, { status: 404 });

    const row = job.data as JobRow;
    if (row.status !== "completed") {
      return Response.json({ error: "视频尚未生成完成。" }, { status: 409 });
    }

    // 还没入库的视频先转存一次。复用与轮询自动保存完全相同的那条实现，
    // 因此不会重复下载、不会产生第二份拷贝，失败时任务状态也不受影响。
    let asset = await findVideoAsset(supabase, id);
    let signedUrl: string | null;
    if (asset) {
      signedUrl = await signVideoAsset(supabase, asset, SIGNED_URL_TTL_SECONDS);
    } else {
      const result = await persistVideoAsset(supabase, user.id, id, { alreadySaved: null });
      if ("asset" in result) {
        asset = result.asset;
        signedUrl = await signVideoAsset(supabase, asset, SIGNED_URL_TTL_SECONDS);
      } else if ("error" in result) {
        // 临时地址过期（403/404）等不可重试的失败会走到这里。任务仍是 completed，
        // 只是这一份视频已经取不回来了 —— 如实说明，并指向「重新生成」。
        return Response.json(
          { error: "视频文件暂时无法取回，请稍后重试；若持续失败，该视频的临时地址可能已过期，需要重新生成。" },
          { status: 502 },
        );
      } else {
        return Response.json({ error: "视频尚未生成完成。" }, { status: 409 });
      }
    }
    if (!signedUrl) {
      return Response.json({ error: "视频下载地址生成失败，请稍后重试。" }, { status: 502 });
    }

    const fileName = `${safeFileNameStem(asset.original_name) || `video-${id.slice(0, 8)}`}.mp4`;

    // 先取长度再决定是否转发 Range：后缀写法 `bytes=-N` 需要知道文件总长才能算出起点。
    // HEAD 只读元数据，不产生任何计费，也不会重新调用 Provider。
    const head = await fetchWithTimeout(signedUrl, { method: "HEAD", cache: "no-store" }, PROBE_TIMEOUT_MS);
    if (!head.ok) {
      return Response.json(
        { error: isRetriableDownloadStatus(head.status) ? "视频下载失败，请稍后重试。" : "视频文件已不可读取。" },
        { status: 502 },
      );
    }

    const size = Number(head.headers.get("content-length") ?? 0) || asset.size_bytes || 0;
    if (size > MAX_VIDEO_BYTES) {
      return Response.json({ error: "视频体积超过下载上限。" }, { status: 502 });
    }
    // 上游存的就是 video/mp4（转存时写死的），这里仍读一次响应头，避免将来允许
    // webm 时下载下来的文件类型对不上。
    const contentType = head.headers.get("content-type") ?? "video/mp4";

    const rangeHeader = request.headers.get("range");
    const range = parseByteRange(rangeHeader, size);

    // 有 Range 但解析不出来：可能是起点越界，也可能是多段/畸形写法。
    // 前者按规范必须回 416，后者退化成整文件（下面走 200 分支）。
    if (isWellFormedRange(rangeHeader) && !range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
      });
    }

    const upstreamHeaders: Record<string, string> = {};
    if (range) upstreamHeaders.range = `bytes=${range.start}-${range.end}`;
    // 这一跳**不能**加超时（理由见 fetchStreaming）。取消只跟随客户端断连：
    // 用户关掉页面时由运行时触发 request.signal，既省上游流量又不会误伤慢速下载。
    const upstream = await fetchStreaming(signedUrl, {
      headers: upstreamHeaders,
      signal: request.signal,
    });
    if (!upstream.ok) {
      return Response.json(
        { error: isRetriableDownloadStatus(upstream.status) ? "视频下载失败，请稍后重试。" : "视频文件已不可读取。" },
        { status: 502 },
      );
    }

    // 快速取出响应体，避免上游连接被运行时闲置回收。
    const body = upstream.body;

    // 一次下载的总时长由“取地址 + 转发”两跳共同决定，因此这里不再叠加超时，
    // 直接把上游的响应体交给运行时流式转发（不做任何缓冲，边下边发）。
    const headers = new Headers({
      "Content-Type": contentType,
      // 文件名提示，见 contentDisposition 的说明（用 inline，不用 attachment）。
      "Content-Disposition": contentDisposition(fileName),
      // 私有内容：可以在这台设备上留一份，但任何共享缓存都不许存。
      "Cache-Control": "private, max-age=3600",
      // 显式声明支持区间，某些客户端会据此决定要不要发 Range 探测。
      "Accept-Ranges": "bytes",
    });

    if (range && upstream.status === 206) {
      // 上游确实按区间返回了（Supabase Storage 走 S3，稳定支持）。
      headers.set("Content-Length", String(range.end - range.start + 1));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      return new Response(body, { status: 206, headers });
    }

    // 上游忽略了 Range（回 200 整文件）：如实回 200 + 真实长度。
    // **绝不能**谎报 206：那样 Content-Length 会比实际字节少，客户端读到 EOF 前就截断。
    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (declared) headers.set("Content-Length", String(declared));
    return new Response(body, { status: 200, headers });
  } catch (error) {
    return jsonError(error);
  }
}
