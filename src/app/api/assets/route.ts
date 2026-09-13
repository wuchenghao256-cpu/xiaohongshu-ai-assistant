import { z } from "zod";
import { jsonError } from "@/lib/http";
import { sanitizeImageFilename } from "@/lib/images/image-files";
import { requireUser } from "@/lib/supabase/auth";

const assetSchema = z.object({
  taskId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  originalName: z.string().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(8 * 1024 * 1024),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  selectedForPublishing: z.boolean().default(true),
});

const selectionSchema = z.object({
  id: z.string().uuid(),
  selected: z.boolean(),
});

/**
 * 素材库需要一次拿到当前用户「上传的原始图 + 生成成功的图」。
 * 逐张签名并发执行，避免每张图串行等待一次 Storage 往返。
 */
export async function GET(request: Request) {
  try {
    const limit = z.coerce.number().int().min(1).max(200).default(120)
      .parse(new URL(request.url).searchParams.get("limit") ?? undefined);
    const { user, supabase } = await requireUser();
    const { data, error } = await supabase
      .from("assets")
      .select("id,task_id,storage_bucket,storage_path,original_name,mime_type,size_bytes,width,height,selected_for_publishing,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    // 商品名单独查一次，不用嵌套 select：assets 指向 content_tasks 的是复合外键
    // (task_id, user_id)，依赖 PostgREST 的关系推断容易脆断。
    const taskIds = [...new Set((data ?? []).map((asset) => asset.task_id))];
    const namesByTask = new Map<string, string>();
    if (taskIds.length) {
      const tasks = await supabase.from("content_tasks").select("id,product_name").in("id", taskIds);
      if (tasks.error) throw tasks.error;
      for (const task of tasks.data ?? []) namesByTask.set(task.id, task.product_name ?? "");
    }

    const assets = await Promise.all((data ?? []).map(async (asset) => {
      const signed = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
      return {
        id: asset.id,
        taskId: asset.task_id,
        name: asset.original_name,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
        width: asset.width,
        height: asset.height,
        selected: asset.selected_for_publishing,
        createdAt: asset.created_at,
        productName: namesByTask.get(asset.task_id) ?? "",
        // 生成图由 AI 命名（AI模特商品图-… / AI生成商品图-…），据此区分来源。
        origin: asset.original_name.startsWith("AI") ? "generated" as const : "uploaded" as const,
        url: signed.data?.signedUrl ?? "",
      };
    }));

    return Response.json({ assets: assets.filter((asset) => asset.url) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const input = assetSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    if (!input.storagePath.startsWith(`${user.id}/`)) {
      return Response.json({ error: "无效的图片路径。" }, { status: 403 });
    }
    const { data, error } = await supabase.from("assets").insert({
      user_id: user.id,
      task_id: input.taskId,
      storage_path: input.storagePath,
      original_name: sanitizeImageFilename(input.originalName, input.mimeType),
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      selected_for_publishing: input.selectedForPublishing,
    }).select("id, storage_path, original_name, mime_type, size_bytes").single();
    if (error) throw error;
    return Response.json({ asset: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) return Response.json({ error: "图片 ID 无效。" }, { status: 400 });
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("assets").select("storage_path").eq("id", id).single();
    if (error) throw error;
    const storageResult = await supabase.storage.from("product-assets").remove([data.storage_path]);
    if (storageResult.error) throw storageResult.error;
    const deleteResult = await supabase.from("assets").delete().eq("id", id);
    if (deleteResult.error) throw deleteResult.error;
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    const input = selectionSchema.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("assets")
      .update({ selected_for_publishing: input.selected })
      .eq("id", input.id)
      .select("id, selected_for_publishing")
      .single();
    if (error) throw error;
    return Response.json({ asset: data });
  } catch (error) {
    return jsonError(error);
  }
}
