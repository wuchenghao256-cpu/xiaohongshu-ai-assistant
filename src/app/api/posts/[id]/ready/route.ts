import { jsonError } from "@/lib/http";
import { getPublishingProvider } from "@/lib/publishing/xiaohongshu-publisher";
import { requireUser } from "@/lib/supabase/auth";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    const post = await supabase
      .from("posts")
      .select("id, task_id, title, body, hashtags, status")
      .eq("id", id)
      .single();
    if (post.error) throw post.error;
    if (post.data.status !== "final" || !post.data.title.trim() || !post.data.body.trim()) {
      return Response.json(
        { error: "请先选择并保存最终文案，再准备发布。", code: "FINAL_POST_REQUIRED" },
        { status: 400 },
      );
    }

    const assets = await supabase
      .from("assets")
      .select("storage_path")
      .eq("task_id", post.data.task_id)
      .eq("selected_for_publishing", true)
      .order("created_at");
    if (assets.error) throw assets.error;
    if (!assets.data.length) {
      return Response.json(
        { error: "请至少选择并保存一张待发布图片。", code: "PUBLISHING_IMAGE_REQUIRED" },
        { status: 400 },
      );
    }

    const imageUrls = await Promise.all(assets.data.map(async (asset) => {
      const signed = await supabase.storage.from("product-assets").createSignedUrl(asset.storage_path, 600);
      if (signed.error) throw signed.error;
      return signed.data.signedUrl;
    }));
    const provider = getPublishingProvider();
    const result = await provider.publishPost({
      postId: id,
      title: post.data.title,
      body: post.data.body,
      hashtags: post.data.hashtags,
      imageUrls,
    });
    const update = await supabase.from("posts").update({ publish_status: result.status }).eq("id", id).select("*").single();
    if (update.error) throw update.error;
    const job = await supabase.from("publishing_jobs").insert({ user_id: user.id, post_id: id, provider: provider.id, status: result.status }).select("id").single();
    if (job.error) throw job.error;
    return Response.json({
      post: update.data,
      publishingJobId: job.data.id,
      publishingCode: result.code,
      manualConfirmationRequired: result.manualConfirmationRequired,
    });
  } catch (error) { return jsonError(error); }
}
