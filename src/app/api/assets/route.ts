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
});

const selectionSchema = z.object({
  id: z.string().uuid(),
  selected: z.boolean(),
});

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
