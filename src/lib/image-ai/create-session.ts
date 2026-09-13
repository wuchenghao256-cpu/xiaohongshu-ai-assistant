import "server-only";
import {
  countTaskAssets,
  getLatestBatch,
  listBatchChildren,
  signBatchAssets,
  type BatchAsset,
  type BatchRecord,
  type ChildJob,
  type ServerSupabase,
} from "@/lib/image-ai/batches";
import { classifyRound, type RoundState } from "@/lib/image-ai/round";

/** 本轮（一个 content_task）里的一张图，参考图与成图共用一套字段给工作区渲染。 */
export type SessionAsset = {
  id: string;
  taskId: string;
  storagePath: string;
  name: string;
  sizeBytes: number;
  signedUrl: string;
  kind: "uploaded" | "generated";
};

export type CreateSession = {
  taskId: string;
  productName: string;
  state: Exclude<RoundState, "none">;
  assetCount: number;
  referenceAssets: SessionAsset[];
  generatedAssets: SessionAsset[];
  selectedAssetIds: string[];
  batch: BatchRecord | null;
  children: ChildJob[];
  /** 最近一批的成图，用于刷新后立刻恢复批次面板（重试按钮依赖 children）。 */
  batchAssets: BatchAsset[];
};

/** 内部用：多带一个 selected 标记，拆成 referenceAssets / generatedAssets 前先取出来。 */
type SessionAssetRow = SessionAsset & { selected: boolean };

/**
 * 刷新 /create 时判断「上一轮还能不能接着用」。
 *
 * 判定只用数据库里的事实：任务存在 + assets 计数。额度没满就继续沿用同一 task_id，
 * 这样正在生成的任务刷新后不会丢、失败的批次还能重试；额度满了（finished）则由
 * 客户端在用户下次上传/生成时开新任务。这里不自动建任务——建任务是用户动作。
 */
export async function loadCreateSession(
  supabase: ServerSupabase,
  userId: string,
  candidateTaskId: string | null,
): Promise<CreateSession | null> {
  if (!candidateTaskId) return null;
  const task = await supabase
    .from("content_tasks")
    .select("id, product_name")
    .eq("id", candidateTaskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (task.error) throw task.error;
  if (!task.data) return null;

  const assetCount = await countTaskAssets(supabase, candidateTaskId);
  const state = classifyRound({ hasTask: true, assetCount });
  if (state === "none") return null;

  const rows = await supabase
    .from("assets")
    .select("id,task_id,storage_bucket,storage_path,original_name,size_bytes,selected_for_publishing,created_at")
    .eq("task_id", candidateTaskId)
    .order("created_at");
  if (rows.error) throw rows.error;

  const signed = await Promise.all((rows.data ?? []).map(async (asset): Promise<SessionAssetRow | null> => {
    const url = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
    if (!url.data?.signedUrl) return null;
    return {
      id: asset.id,
      taskId: asset.task_id,
      storagePath: asset.storage_path,
      name: asset.original_name,
      sizeBytes: asset.size_bytes,
      signedUrl: url.data.signedUrl,
      // 生成图由 AI 命名（AI模特商品图-… / AI生成商品图-…），与素材库同一套判据。
      kind: asset.original_name.startsWith("AI") ? "generated" as const : "uploaded" as const,
      selected: asset.selected_for_publishing,
    };
  }));
  const sessionAssets = signed.filter((asset): asset is SessionAssetRow => asset !== null);

  const latestBatch = await getLatestBatch(supabase, candidateTaskId);
  const children = latestBatch ? await listBatchChildren(supabase, latestBatch.id) : [];
  const batchAssets = children.length ? await signBatchAssets(supabase, children) : [];

  return {
    taskId: candidateTaskId,
    productName: task.data.product_name ?? "",
    state,
    assetCount,
    referenceAssets: sessionAssets.filter((asset) => asset.kind === "uploaded"),
    generatedAssets: sessionAssets.filter((asset) => asset.kind === "generated"),
    selectedAssetIds: sessionAssets.filter((asset) => asset.selected).map((asset) => asset.id),
    batch: latestBatch,
    children,
    batchAssets,
  };
}

export type { BatchAsset, BatchRecord, ChildJob };
