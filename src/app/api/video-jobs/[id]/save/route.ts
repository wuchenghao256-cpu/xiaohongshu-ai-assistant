import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "@/lib/video/fetch";
import { logVideoEvent } from "@/lib/video/log";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** 下载与上传都只重试，绝不重新调用视频 Provider —— 视频已经生成并计费过了。 */
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 700;

function isRetriableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * 已生成成功的视频只存在于方舟返回的临时签名地址（约 24 小时过期），
 * 所以转存失败必须可重试，不能因为一次网络抖动让视频永久丢失。
 * 这里只重放「下载 → 上传 → 写库」这三步，不会产生任何新的付费任务。
 */
async function persistedAsset(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], jobId: string) {
  const existing = await supabase.from("video_assets").select("id,storage_path,original_name,size_bytes").eq("video_job_id", jobId).maybeSingle();
  if (existing.error) throw existing.error;
  return existing.data;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const startedAt = Date.now();
  try {
    const { user, supabase } = await requireUser();

    // 已经存过就直接返回：重复点击「保存到作品库」不会产生第二份拷贝，
    // 也修掉了原来刷新后按钮消失、视频无法再入库的问题。
    const already = await persistedAsset(supabase, id);
    if (already) return Response.json({ asset: already });

    const job = await supabase.from("video_jobs").select("output_url,status").eq("id", id).single();
    if (job.error) return Response.json({ error: "视频任务不存在。" }, { status: 404 });
    if (job.data.status !== "completed" || !job.data.output_url) {
      logVideoEvent("save.failed", { jobId: id, category: "not_ready", durationMs: Date.now() - startedAt });
      return Response.json({ error: "视频尚未生成完成。" }, { status: 409 });
    }

    const outputUrl = new URL(job.data.output_url);
    if (outputUrl.protocol !== "https:") return Response.json({ error: "视频地址无效。" }, { status: 400 });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchWithTimeout(outputUrl, { cache: "no-store" }, DOWNLOAD_TIMEOUT_MS);
        if (!response.ok) {
          // 临时地址过期会返回 403/404：这是不可重试的，重试只会白等。
          if (!isRetriableStatus(response.status)) break;
          throw new Error(`视频下载失败（HTTP ${response.status}）`);
        }
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > MAX_VIDEO_BYTES) break;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) break;

        const path = `${user.id}/${crypto.randomUUID()}.mp4`;
        const upload = await supabase.storage.from("video-assets").upload(path, bytes, { contentType: "video/mp4", upsert: false });
        if (upload.error) throw new Error("视频转存失败");
        const asset = await supabase.from("video_assets").insert({
          user_id: user.id, video_job_id: id, storage_path: path,
          original_name: `AI视频-${id.slice(0, 8)}.mp4`, size_bytes: bytes.length,
        }).select("id,storage_path,original_name,size_bytes").single();
        if (asset.error) {
          // 写库失败要把已经上传的对象删掉，避免留下没有记录的孤儿文件。
          await supabase.storage.from("video-assets").remove([path]);
          throw new Error("视频记录写入失败");
        }
        logVideoEvent("save.ok", { jobId: id, attempt, durationMs: Date.now() - startedAt });
        return Response.json({ asset: asset.data }, { status: 201 });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("视频保存失败");
        if (attempt < UPLOAD_MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_BASE_DELAY_MS * attempt));
      }
    }

    logVideoEvent("save.failed", { jobId: id, attempt: UPLOAD_MAX_ATTEMPTS, category: lastError?.message ?? "unknown", durationMs: Date.now() - startedAt });
    return Response.json({ error: "视频保存失败，请稍后重试。视频仍保留在任务列表中。" }, { status: 502 });
  } catch (error) { return jsonError(error); }
}
