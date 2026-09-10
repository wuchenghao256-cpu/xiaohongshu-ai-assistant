import { getAiProvider } from "@/lib/ai/client";
import { XHS_PROMPT_VERSION } from "@/lib/ai/prompts";
import { generationInputSchema } from "@/lib/ai/types";
import { jsonError } from "@/lib/http";
import { requireUser } from "@/lib/supabase/auth";

export async function POST(request: Request) {
  let generationId: string | undefined;
  let taskId: string | undefined;
  try {
    const input = generationInputSchema.parse(await request.json());
    taskId = input.taskId;
    const { user, supabase } = await requireUser();
    const provider = getAiProvider();
    const taskUpdate = await supabase.from("content_tasks").update({
      product_name: input.productName,
      category: input.category,
      description: input.description,
      selling_points: input.sellingPoints,
      target_audience: input.targetAudience,
      price: input.price || null,
      brand_name: input.brandName || null,
      writing_style: input.style,
      custom_style: input.customStyle || null,
      additional_info: input.additionalInfo || null,
      generation_status: "generating",
      error_message: null,
    }).eq("id", input.taskId);
    if (taskUpdate.error) throw taskUpdate.error;

    const generation = await supabase.from("ai_generations").insert({
      user_id: user.id,
      task_id: input.taskId,
      provider: provider.name,
      model: provider.model,
      prompt_version: XHS_PROMPT_VERSION,
      status: "generating",
      input_snapshot: { ...input, assetIds: input.assetIds },
    }).select("id").single();
    if (generation.error) throw generation.error;
    generationId = generation.data.id;

    const assets = input.assetIds.length
      ? await supabase.from("assets").select("id, storage_path, mime_type").in("id", input.assetIds).eq("task_id", input.taskId)
      : { data: [], error: null };
    if (assets.error) throw assets.error;
    const imageResults = await Promise.all((assets.data ?? []).map(async (asset) => {
      const signed = await supabase.storage.from("product-assets").createSignedUrl(asset.storage_path, 600);
      if (signed.error) throw signed.error;
      return { url: signed.data.signedUrl, mimeType: asset.mime_type };
    }));

    const result = await provider.generateXiaohongshuPost(input, imageResults);
    console.info("AI generation quality check", {
      generationId,
      correctionApplied: result.diagnostics.qualityCorrectionApplied,
      initialIssues: result.diagnostics.initialQuality.issues,
      finalIssues: result.diagnostics.finalQuality.issues,
    });
    const variants = result.variants.map((variant, index) => ({
      user_id: user.id,
      task_id: input.taskId,
      generation_id: generationId,
      version_number: index + 1,
      ...variant,
    }));
    const insertVariants = await supabase.from("post_variants").insert(variants).select("*");
    if (insertVariants.error) throw insertVariants.error;
    const firstVariant = result.variants[0];
    const draftPost = await supabase.from("posts").upsert({
      user_id: user.id,
      task_id: input.taskId,
      title: firstVariant.title,
      body: firstVariant.body,
      hashtags: firstVariant.hashtags,
      status: "draft",
      publish_status: "draft",
      error_message: null,
    }, { onConflict: "task_id" }).select("id").single();
    if (draftPost.error) throw draftPost.error;
    await Promise.all([
      supabase.from("ai_generations").update({ status: "completed" }).eq("id", generationId),
      supabase.from("content_tasks").update({ generation_status: "completed" }).eq("id", input.taskId),
    ]);
    return Response.json({ generationId, draftPostId: draftPost.data.id, model: provider.model, variants: insertVariants.data });
  } catch (error) {
    try {
      const { supabase } = await requireUser();
      const message = error instanceof Error ? error.message.slice(0, 500) : "生成失败";
      const updates = [];
      if (generationId) updates.push(supabase.from("ai_generations").update({ status: "failed", error_message: message }).eq("id", generationId));
      if (taskId) updates.push(supabase.from("content_tasks").update({ generation_status: "failed", error_message: message }).eq("id", taskId));
      await Promise.all(updates);
    } catch { /* Original error is more useful. */ }
    return jsonError(error);
  }
}
