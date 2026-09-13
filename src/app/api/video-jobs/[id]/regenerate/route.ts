import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createProviderTask } from "@/lib/video/provider";
import { videoJobInputSchema, withoutIdempotencyKey } from "@/lib/video/types";

/** 重新生成总会创建一个全新的付费任务，因此必须清除幂等令牌。 */
const REUSABLE_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,created_at,updated_at,completed_at";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    const source = await supabase.from("video_jobs").select("input_snapshot").eq("id", id).single();
    if (source.error) throw source.error;
    const input = videoJobInputSchema.parse(source.data.input_snapshot);
    const config = await getEnabledProviderConfig(user.id, "video");
    if (!config) throw new Error("请先在系统设置 → 视频模型中启用视频 Provider。");
    const urls = await Promise.all(input.inputPaths.map(async (path) => {
      const signed = await supabase.storage.from("product-assets").createSignedUrl(path, 86400);
      if (signed.error) throw signed.error; return signed.data.signedUrl;
    }));
    const created = await supabase.from("video_jobs").insert({
      user_id: user.id, kind: input.kind, status: "queued", progress: 0, provider: config.provider,
      input_snapshot: withoutIdempotencyKey(input),
    }).select(REUSABLE_COLUMNS).single();
    if (created.error) throw created.error;
    try {
      const externalTaskId = await createProviderTask(config, input, urls);
      const updated = await supabase.from("video_jobs").update({
        status: "generating", progress: 5, external_task_id: externalTaskId, submitted_at: new Date().toISOString(),
      }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      if (updated.error) throw updated.error;
      return Response.json({ job: updated.data }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "视频任务创建失败";
      const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      if (failed.error) throw failed.error;
      return Response.json({ job: failed.data }, { status: 201 });
    }
  } catch (error) { return jsonError(error); }
}
