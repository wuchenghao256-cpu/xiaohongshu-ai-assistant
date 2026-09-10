import { z } from "zod";
import { jsonError } from "@/lib/http";
import { isSupportedShareImageType } from "@/lib/sharing/share-images";
import { requireUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return Response.json({ error: "内容 ID 无效。" }, { status: 400 });
    }

    const { user, supabase } = await requireUser();
    const post = await supabase
      .from("posts")
      .select("id,task_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (post.error) throw post.error;
    if (!post.data) return Response.json({ error: "内容不存在或无权访问。" }, { status: 404 });

    const assets = await supabase
      .from("assets")
      .select("id,storage_bucket,storage_path,original_name,mime_type")
      .eq("task_id", post.data.task_id)
      .eq("user_id", user.id)
      .eq("selected_for_publishing", true)
      .order("created_at");
    if (assets.error) throw assets.error;
    if (!assets.data.length) return Response.json({ error: "没有选中的发布图片。" }, { status: 404 });

    for (const asset of assets.data) {
      if (!asset.storage_path.startsWith(`${user.id}/`)) {
        return Response.json({ error: "检测到无法安全确认归属的图片。" }, { status: 409 });
      }
      if (!isSupportedShareImageType(asset.mime_type)) {
        return Response.json({ error: `图片 ${asset.original_name} 不是 JPEG、PNG 或 WebP。` }, { status: 415 });
      }
    }

    const images = await Promise.all(assets.data.map(async (asset) => {
      const signed = await supabase.storage
        .from(asset.storage_bucket)
        .createSignedUrl(asset.storage_path, 300);
      if (signed.error) throw signed.error;
      return {
        id: asset.id,
        name: asset.original_name,
        mimeType: asset.mime_type,
        url: signed.data.signedUrl,
      };
    }));

    return Response.json({ images }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return jsonError(error);
  }
}

