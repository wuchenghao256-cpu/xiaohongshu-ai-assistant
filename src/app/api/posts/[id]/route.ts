import { z } from "zod";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("posts").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return Response.json({ post: data });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "内容 ID 无效。" }, { status: 400 });
    }
    const { user, supabase } = await requireUser();
    const postResult = await supabase
      .from("posts")
      .select("id,task_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (postResult.error) throw postResult.error;
    if (!postResult.data) {
      return Response.json({ error: "内容不存在或无权删除。" }, { status: 404 });
    }

    const assetsResult = await supabase
      .from("assets")
      .select("storage_bucket,storage_path")
      .eq("task_id", postResult.data.task_id)
      .eq("user_id", user.id);
    if (assetsResult.error) throw assetsResult.error;

    const assetsByBucket = new Map<string, string[]>();
    for (const asset of assetsResult.data ?? []) {
      if (asset.storage_bucket !== "product-assets") continue;
      if (!asset.storage_path.startsWith(`${user.id}/`)) {
        return Response.json({ error: "检测到无法安全确认归属的图片，已停止删除。" }, { status: 409 });
      }
      const paths = assetsByBucket.get(asset.storage_bucket) ?? [];
      paths.push(asset.storage_path);
      assetsByBucket.set(asset.storage_bucket, paths);
    }
    for (const [bucket, paths] of assetsByBucket) {
      const storageResult = await supabase.storage.from(bucket).remove(paths);
      if (storageResult.error) throw storageResult.error;
    }

    const deleteResult = await supabase
      .from("content_tasks")
      .delete()
      .eq("id", postResult.data.task_id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (deleteResult.error) throw deleteResult.error;
    if (!deleteResult.data) {
      return Response.json({ error: "内容删除失败，请刷新后重试。" }, { status: 409 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
