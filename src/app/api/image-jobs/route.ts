import { z } from "zod";
import { after } from "next/server";
import { jsonError } from "@/lib/http";
import { getImageGenerationProvider } from "@/lib/image-ai/client";
import { classifyImageFailure, logImageFailure, type ImageFailureCategory } from "@/lib/image-ai/failure";
import { productImageRequestSchema } from "@/lib/image-ai/types";
import { requireUser } from "@/lib/supabase/auth";
import { IMAGE_RETRY_BASE_DELAY_MS, IMAGE_RETRY_MAX_ATTEMPTS, runWithConcurrency, withExponentialRetry } from "@/lib/jobs/orchestrator";

const createSchema = productImageRequestSchema.refine((value) => "mode" in value, "仅支持模特商品图批次");
const retrySchema = z.object({ batchId: z.string().uuid() });
export const maxDuration = 300;

type ServerSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type ChildRow = { id: string; position: number };
class GenerateRequestError extends Error { constructor(message: string, readonly status: number, readonly category?: ImageFailureCategory) { super(message); } }

/** 子任务表只存自由文本，这里把分类前缀写进去，前端和日志都能直接读懂。 */
function withCategory(category: ImageFailureCategory, message: string) {
  return `[${category}] ${message}`;
}

/**
 * PostgrestError / StorageError 是普通对象，不是 Error 实例；不转换的话
 * 上层日志只能看到 "unknown"，无法区分是数据库写入失败还是策略被拒。
 */
function withContext(error: unknown, context: string) {
  if (error instanceof Error) {
    error.message = `${context}: ${error.message}`;
    return error;
  }
  return new Error(`${context}: ${JSON.stringify(error).slice(0, 400)}`);
}

async function updateChild(supabase: ServerSupabase, job: ChildRow, status: "generating" | "completed" | "failed", attempts: number, assetId?: string, errorMessage?: string) {
  const result = await supabase.from("image_child_jobs").update({ status, attempts, asset_id: assetId ?? null, error_message: errorMessage ?? null }).eq("id", job.id);
  if (result.error) throw result.error;
}

async function finishBatch(supabase: ServerSupabase, batchId: string) {
  const rows = await supabase.from("image_child_jobs").select("status").eq("batch_id", batchId);
  if (rows.error) throw rows.error;
  const completed = rows.data.filter((item) => item.status === "completed").length;
  const failed = rows.data.filter((item) => item.status === "failed").length;
  const active = rows.data.some((item) => item.status === "queued" || item.status === "generating");
  const status = active ? "generating" : failed === rows.data.length ? "failed" : "completed";
  await supabase.from("image_batch_jobs").update({ status, completed_count: completed, failed_count: failed }).eq("id", batchId);
}

async function markBatchFatal(supabase: ServerSupabase, batchId: string, error: unknown) {
  const failure = logImageFailure("batch-background", error, { batchId });
  await supabase.from("image_child_jobs").update({ status: "failed", error_message: withCategory(failure.category, failure.message) }).eq("batch_id", batchId).in("status", ["queued", "generating"]);
  await finishBatch(supabase, batchId);
}

/**
 * 重试判定完全交给失败分类器：429 / 5xx / 超时 / 下载失败重试；
 * 内容审核拒绝、参数错误不重试（重试只会再被拒一次并浪费额度）。
 */
function isRetriable(error: unknown) {
  if (error instanceof GenerateRequestError && error.category) {
    return isRetriableCategory(error.category);
  }
  if (error instanceof GenerateRequestError) return error.status === 429 || error.status >= 500;
  return classifyImageFailure(error).retriable;
}

const retriableCategories: ImageFailureCategory[] = ["RATE_LIMITED", "PROVIDER_ERROR", "TIMEOUT", "STORAGE_FAILED", "DB_FAILED", "POLLING_FAILED", "UNKNOWN"];
function isRetriableCategory(category: ImageFailureCategory) {
  return retriableCategories.includes(category);
}

async function processBatch(input: z.infer<typeof createSchema>, batchId: string, children: ChildRow[], supportsOutputCount: boolean, supabase: ServerSupabase, requestUrl: string, cookie: string) {
  const generate = async (count: number, position?: number) => {
    const response = await fetch(new URL("/api/images/generate", requestUrl), {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ ...input, count, position }), cache: "no-store",
    });
    const data = await response.json() as { assets?: Array<{ id: string }>; error?: string; category?: ImageFailureCategory };
    if (!response.ok || !data.assets) throw new GenerateRequestError(data.error ?? "图片生成失败", response.status, data.category);
    return data.assets;
  };
  const retriable = isRetriable;
  await supabase.from("image_batch_jobs").update({ status: "generating" }).eq("id", batchId);
  if (supportsOutputCount && children.length === 4) {
    let batchAttempt = 0;
    try {
      const assets = await withExponentialRetry(async (attempt) => {
        batchAttempt = attempt;
        await Promise.all(children.map((job) => updateChild(supabase, job, "generating", attempt)));
        return generate(4, children[0].position);
      }, retriable, { maxAttempts: IMAGE_RETRY_MAX_ATTEMPTS, baseDelayMs: IMAGE_RETRY_BASE_DELAY_MS });
      await Promise.all(children.map((job, index) => updateChild(supabase, job, "completed", batchAttempt, assets[index].id)));
      await finishBatch(supabase, batchId);
      return;
    } catch {
      await Promise.all(children.map((job) => updateChild(supabase, job, "generating", 1, undefined, "批量输出失败，已切换单张重试")));
    }
  }
  await runWithConcurrency(children.map((job) => async () => {
    let attempt = 0;
    try {
      const asset = await withExponentialRetry(async (currentAttempt) => {
        attempt = currentAttempt;
        await updateChild(supabase, job, "generating", currentAttempt);
        return (await generate(1, job.position))[0];
      }, retriable, { maxAttempts: IMAGE_RETRY_MAX_ATTEMPTS, baseDelayMs: IMAGE_RETRY_BASE_DELAY_MS });
      await updateChild(supabase, job, "completed", attempt, asset.id);
    } catch (error) {
      const failure = classifyImageFailure(error);
      logImageFailure("batch-child", error, { batchId, position: job.position, attempts: Math.max(1, attempt) });
      await updateChild(supabase, job, "failed", Math.max(1, attempt), undefined, withCategory(failure.category, error instanceof Error ? error.message : failure.message));
      throw error;
    }
  }), 2);
  await finishBatch(supabase, batchId);
}

async function presentBatch(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], batchId: string) {
  const batch = await supabase.from("image_batch_jobs").select("id,task_id,status,total_count,completed_count,failed_count,request_snapshot,created_at,updated_at").eq("id", batchId).single();
  if (batch.error) throw batch.error;
  const children = await supabase.from("image_child_jobs").select("id,position,status,attempts,asset_id,error_message,updated_at").eq("batch_id", batchId).order("position");
  if (children.error) throw children.error;
  const assetIds = (children.data ?? []).flatMap((item) => item.asset_id ? [item.asset_id] : []);
  const assets = assetIds.length ? await supabase.from("assets").select("id,storage_path,original_name,mime_type,size_bytes").in("id", assetIds) : { data: [], error: null };
  if (assets.error) throw assets.error;
  const signedAssets = await Promise.all((assets.data ?? []).map(async (asset) => {
    const signed = await supabase.storage.from("product-assets").createSignedUrl(asset.storage_path, 3600);
    return signed.error ? null : { ...asset, signedUrl: signed.data.signedUrl };
  }));
  return { batch: batch.data, children: children.data ?? [], assets: signedAssets.filter(Boolean) };
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const batch = await supabase.from("image_batch_jobs").insert({
      user_id: user.id, task_id: input.taskId, total_count: input.count,
      request_snapshot: input,
    }).select("id").single();
    if (batch.error) throw batch.error;
    const children = await supabase.from("image_child_jobs").insert(
      Array.from({ length: input.count }, (_, index) => ({
        batch_id: batch.data.id, user_id: user.id, task_id: input.taskId, position: index + 1,
      })),
    ).select("id,position,status,attempts,asset_id,error_message,updated_at").order("position");
    if (children.error) throw children.error;
    const provider = await getImageGenerationProvider(user.id);
    const supportsOutputCount = provider.supportsOutputCount === true;
    after(() => processBatch(input, batch.data.id, children.data, supportsOutputCount, supabase, request.url, request.headers.get("cookie") ?? "").catch((error) => markBatchFatal(supabase, batch.data.id, error)));
    return Response.json({
      batch: { id: batch.data.id, task_id: input.taskId, status: "queued", total_count: input.count, completed_count: 0, failed_count: 0 },
      children: children.data,
      assets: [],
      supportsOutputCount,
    }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request) {
  try {
    const taskId = z.string().uuid().parse(new URL(request.url).searchParams.get("taskId"));
    const { supabase } = await requireUser();
    const latest = await supabase.from("image_batch_jobs").select("id").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest.error) throw latest.error;
    return Response.json(latest.data ? await presentBatch(supabase, latest.data.id) : { batch: null, children: [], assets: [] });
  } catch (error) {
    // 轮询失败必须让前端看见：静默返回错误会让页面停在「生成中」永远转圈。
    return jsonError(withContext(error, "查询图片任务进度失败"));
  }
}

export async function PATCH(request: Request) {
  try {
    const { batchId } = retrySchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const reset = await supabase.from("image_child_jobs").update({ status: "queued", attempts: 0, error_message: null }).eq("batch_id", batchId).eq("status", "failed").select("id");
    if (reset.error) throw reset.error;
    const parent = await supabase.from("image_batch_jobs").update({ status: "queued", failed_count: 0 }).eq("id", batchId).select("request_snapshot").single();
    if (parent.error) throw parent.error;
    if (!reset.data.length) {
      // Nothing was actually failed; recompute the batch rather than leaving it pinned to "queued".
      await finishBatch(supabase, batchId);
      return Response.json(await presentBatch(supabase, batchId));
    }
    const state = await presentBatch(supabase, batchId);
    const input = createSchema.parse(parent.data.request_snapshot);
    const provider = await getImageGenerationProvider(user.id);
    const children = state.children.filter((job) => job.status === "queued").map((job) => ({ id: job.id, position: job.position }));
    after(() => processBatch(input, batchId, children, false, supabase, request.url, request.headers.get("cookie") ?? "").catch((error) => markBatchFatal(supabase, batchId, error)));
    return Response.json({ ...state, supportsOutputCount: provider.supportsOutputCount === true });
  } catch (error) { return jsonError(error); }
}
