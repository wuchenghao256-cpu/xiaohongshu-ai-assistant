import "server-only";
import type { requireUser } from "@/lib/supabase/auth";
import { DOWNLOAD_TIMEOUT_MS, fetchWithTimeout } from "@/lib/video/fetch";
import { logVideoEvent } from "@/lib/video/log";
import {
  isOversizedDeclaredLength,
  isRetriableDownloadStatus,
  isUniqueViolation,
  isUsableVideoSize,
} from "@/lib/video/playback";

/**
 * 视频的永久保存（转存）。
 *
 * Wan / Seedance 返回的 output_url 是**临时**地址（百炼明确只有 24 小时），
 * 刷新页面后历史视频必须仍能播放，所以视频一旦生成完成就要转存到私有的
 * video-assets bucket，并把 storage_path 记进 public.video_assets。
 *
 * 三条不可退让的约束：
 *   1. 绝不重新调用视频 Provider —— 视频已经生成并计费过。这里只做
 *      「下载临时地址 → 上传 Storage → 写库」，任何一步失败都只重试这三步。
 *   2. 幂等 —— 唯一索引 video_assets_video_job_id_key 保证一个任务只有一条记录。
 *      重复轮询、重复刷新、重复点「保存到作品库」都不会产生第二份拷贝。
 *      unique_violation 被翻译成「已经保存过」，而不是错误。
 *   3. 绝不因为转存失败去改任务状态 —— 任务仍是 completed，只是还没入库。
 *
 * 判定逻辑（是否需要保存、是否值得重试、唯一冲突如何处理）全部放在
 * playback.ts 里，因为那个模块没有 `server-only`，可以直接被 node --test 覆盖。
 */

const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 700;

export type PersistedVideoAsset = {
  id: string;
  storage_path: string;
  original_name: string;
  size_bytes: number;
};

const ASSET_COLUMNS = "id,storage_path,original_name,size_bytes";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** 该任务已保存的那条记录；没有则 null。 */
export async function findVideoAsset(supabase: Supabase, jobId: string): Promise<PersistedVideoAsset | null> {
  const existing = await supabase.from("video_assets").select(ASSET_COLUMNS).eq("video_job_id", jobId).maybeSingle();
  if (existing.error) throw existing.error;
  return (existing.data as PersistedVideoAsset | null) ?? null;
}

/** 已完成任务及其临时视频地址。 */
export async function loadCompletedJob(supabase: Supabase, jobId: string): Promise<{ outputUrl: string } | null> {
  const job = await supabase.from("video_jobs").select("output_url,status").eq("id", jobId).single();
  if (job.error || job.data.status !== "completed" || !job.data.output_url) return null;
  const outputUrl = new URL(job.data.output_url);
  if (outputUrl.protocol !== "https:") return null;
  return { outputUrl: job.data.output_url };
}

/**
 * 把 completed 任务的临时视频转存到 video-assets，并写进 public.video_assets。
 *
 * 可能的结果：
 *   - `{ asset }`   —— 保存成功，或此前已经保存过（幂等）
 *   - `{ error }`   —— 暂时失败，调用方可提示重试；任务状态不受影响
 *   - `{ skipped }` —— 任务还没完成、没有临时地址、或地址不是 https，不必重试
 *
 * 这个函数**不负责**触发时机，只负责「把一件事做成且只做一次」。调用方决定
 * 是自动（轮询完成时）还是手动（用户点「保存到作品库」）调用。
 */
export async function persistVideoAsset(
  supabase: Supabase,
  userId: string,
  jobId: string,
  options: { alreadySaved?: PersistedVideoAsset | null } = {},
): Promise<
  | { asset: PersistedVideoAsset; created: boolean }
  | { error: string }
  | { skipped: true }
> {
  const already = options.alreadySaved ?? (await findVideoAsset(supabase, jobId));
  if (already) return { asset: already, created: false };

  const job = await loadCompletedJob(supabase, jobId);
  if (!job) return { skipped: true };
  const outputUrl = new URL(job.outputUrl);

  const startedAt = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(outputUrl, { cache: "no-store" }, DOWNLOAD_TIMEOUT_MS);
      if (!response.ok) {
        // 临时地址过期返回 403/404：不可重试，直接放弃这一次（任务仍停留在 completed）。
        if (!isRetriableDownloadStatus(response.status)) {
          lastError = `视频下载失败（HTTP ${response.status}）`;
          break;
        }
        throw new Error(`视频下载失败（HTTP ${response.status}）`);
      }
      // 先看声明长度，避免把超大响应整体读进内存。
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (isOversizedDeclaredLength(declared)) {
        lastError = "视频体积超过上限";
        break;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isUsableVideoSize(bytes.length)) {
        lastError = "视频体积异常";
        break;
      }

      // 路径第一段必须是 user id：Storage 的 owner policy 靠它做隔离。
      const path = `${userId}/${crypto.randomUUID()}.mp4`;
      const upload = await supabase.storage.from("video-assets").upload(path, bytes, { contentType: "video/mp4", upsert: false });
      if (upload.error) throw new Error("视频转存失败");

      const asset = await supabase.from("video_assets").insert({
        user_id: userId, video_job_id: jobId, storage_path: path,
        original_name: `AI视频-${jobId.slice(0, 8)}.mp4`, size_bytes: bytes.length,
      }).select(ASSET_COLUMNS).single();

      if (asset.error) {
        // 唯一索引冲突：另一个并发请求（轮询与用户点击同时发生）已经保存成功了。
        // 这里不能当成失败，否则会把一条真实存在的记录报成错误。
        if (isUniqueViolation(asset.error.code)) {
          const winner = await findVideoAsset(supabase, jobId);
          if (winner) return { asset: winner, created: false };
        }
        // 其它写库失败：删掉刚上传的对象，避免留下没有记录的孤儿文件。
        await supabase.storage.from("video-assets").remove([path]);
        throw new Error("视频记录写入失败");
      }

      logVideoEvent("save.ok", { jobId, attempt, auto: true, durationMs: Date.now() - startedAt });
      return { asset: asset.data as PersistedVideoAsset, created: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "视频保存失败";
      if (attempt < UPLOAD_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_BASE_DELAY_MS * attempt));
      }
    }
  }

  logVideoEvent("save.failed", { jobId, attempt: UPLOAD_MAX_ATTEMPTS, category: lastError || "unknown", durationMs: Date.now() - startedAt });
  return { error: lastError || "视频保存失败，请稍后重试。" };
}

/**
 * 自动转存：completed 之后由轮询/恢复流程调用。
 *
 * 返回 signedUrl 供本次响应直接使用（刷新后由列表接口重新签名），
 * 以及真实的 asset 记录，便于调用方把它放进「已入库」的映射里，
 * 而不必自己伪造一条占位记录。
 *
 * 任何失败都**吞掉**，绝不让一次转存问题影响任务状态或轮询结果 ——
 * 用户可以稍后在任务卡片上手动重试保存。
 */
export async function autoPersistAndSign(
  supabase: Supabase,
  userId: string,
  jobId: string,
  saved: PersistedVideoAsset | null,
): Promise<{ saved: boolean; signedUrl: string | null; asset: PersistedVideoAsset | null }> {
  let asset = saved;
  if (!asset) {
    const result = await persistVideoAsset(supabase, userId, jobId, { alreadySaved: null });
    if (!("asset" in result)) return { saved: false, signedUrl: null, asset: null };
    asset = result.asset;
  }
  return { saved: true, signedUrl: await signVideoAsset(supabase, asset), asset };
}

/**
 * 给已保存的视频签一个短期地址。签名读不受 Storage RLS 约束，因此不需要为
 * 匿名角色开任何口子；地址**绝不落库**，每次请求重新签，过期后刷新即可。
 */
export async function signVideoAsset(supabase: Supabase, asset: PersistedVideoAsset, ttlSeconds = 3600): Promise<string | null> {
  const signed = await supabase.storage.from("video-assets").createSignedUrl(asset.storage_path, ttlSeconds);
  return signed.data?.signedUrl ?? null;
}
