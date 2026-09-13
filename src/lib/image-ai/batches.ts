/**
 * 图片批次（父任务 + 子任务 + 成图）的统一读取层。
 * 页面（/create 服务端组件）与路由（/api/image-jobs）都从这里取，避免两处各写一份
 * 查询与签名逻辑后口径漂移——「9 张上限」和「批次进度」必须看同一份数据。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServerSupabase = SupabaseClient;

export type MediaJobStatus = "queued" | "generating" | "completed" | "failed";

export type BatchRecord = {
  id: string;
  task_id: string;
  status: MediaJobStatus;
  total_count: number;
  completed_count: number;
  failed_count: number;
  request_snapshot?: Record<string, unknown>;
};

export type ChildJob = {
  id: string;
  position: number;
  status: MediaJobStatus;
  attempts: number;
  asset_id?: string | null;
  error_message?: string | null;
};

/** 批次里的成图，字段命名与前端 GeneratedAssetRecord 对齐（signedUrl 是驼峰）。 */
export type BatchAsset = {
  id: string;
  /** 归属的 content_task，前端据此判断这张图算不算当前轮次的额度。 */
  taskId: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  signedUrl: string;
};

export type BatchState = {
  batch: BatchRecord;
  children: ChildJob[];
  assets: BatchAsset[];
};

export function isBatchActive(status?: MediaJobStatus | null) {
  return status === "queued" || status === "generating";
}

/**
 * 一个任务已占用的图片额度。口径与 /api/images/generate 的上限检查完全一致
 * （assets 表里按 task_id 计数，上传的参考图也算），两处必须同源，否则前端放行、
 * 服务端拒绝，就会出现「批次建了但子任务全 400」的残缺批次。
 */
export async function countTaskAssets(supabase: ServerSupabase, taskId: string) {
  const result = await supabase
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (result.error) throw result.error;
  return result.count ?? 0;
}

export async function getLatestBatch(supabase: ServerSupabase, taskId: string) {
  const latest = await supabase
    .from("image_batch_jobs")
    .select("id,task_id,status,total_count,completed_count,failed_count,request_snapshot,created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  return (latest.data ?? null) as BatchRecord | null;
}

export async function listBatchChildren(supabase: ServerSupabase, batchId: string) {
  const children = await supabase
    .from("image_child_jobs")
    .select("id,position,status,attempts,asset_id,error_message,updated_at")
    .eq("batch_id", batchId)
    .order("position");
  if (children.error) throw children.error;
  return (children.data ?? []) as ChildJob[];
}

/** 一次签名整批成图；签名失败的行直接跳过，不让单张图拖垮整个面板。 */
export async function signBatchAssets(supabase: ServerSupabase, children: ChildJob[]) {
  const assetIds = children.flatMap((item) => (item.asset_id ? [item.asset_id] : []));
  if (!assetIds.length) return [] as BatchAsset[];
  const assets = await supabase
    .from("assets")
    .select("id,task_id,storage_path,original_name,mime_type,size_bytes")
    .in("id", assetIds);
  if (assets.error) throw assets.error;
  const signed = await Promise.all((assets.data ?? []).map(async (asset): Promise<BatchAsset | null> => {
    const url = await supabase.storage.from("product-assets").createSignedUrl(asset.storage_path, 3600);
    if (url.error) return null;
    return {
      id: asset.id,
      taskId: asset.task_id,
      storage_path: asset.storage_path,
      original_name: asset.original_name,
      mime_type: asset.mime_type,
      size_bytes: asset.size_bytes,
      signedUrl: url.data.signedUrl,
    };
  }));
  return signed.filter((asset): asset is BatchAsset => asset !== null);
}

export async function presentBatch(supabase: ServerSupabase, batchId: string): Promise<BatchState> {
  const batch = await supabase
    .from("image_batch_jobs")
    .select("id,task_id,status,total_count,completed_count,failed_count,request_snapshot,created_at,updated_at")
    .eq("id", batchId)
    .single();
  if (batch.error) throw batch.error;
  const children = await listBatchChildren(supabase, batchId);
  return {
    batch: batch.data as BatchRecord,
    children,
    assets: await signBatchAssets(supabase, children),
  };
}
