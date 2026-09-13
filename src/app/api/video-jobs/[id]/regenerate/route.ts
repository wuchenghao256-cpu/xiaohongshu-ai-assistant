import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createRunwayTask } from "@/lib/video/runway";
import { videoJobInputSchema } from "@/lib/video/types";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    const source = await supabase.from("video_jobs").select("input_snapshot").eq("id", id).single();
    if (source.error) throw source.error;
    const input = videoJobInputSchema.parse(source.data.input_snapshot);
    const config = await getEnabledProviderConfig(user.id, "video");
    if (!config) throw new Error("Runway 视频 API 未配置");
    const urls = await Promise.all(input.inputPaths.map(async (path) => {
      const signed = await supabase.storage.from("product-assets").createSignedUrl(path, 86400);
      if (signed.error) throw signed.error; return signed.data.signedUrl;
    }));
    const created = await supabase.from("video_jobs").insert({ user_id: user.id, kind: input.kind, input_snapshot: input }).select("id,kind,status,progress,created_at").single();
    if (created.error) throw created.error;
    try {
      const externalId = await createRunwayTask(config, input, urls);
      const updated = await supabase.from("video_jobs").update({ status: "generating", progress: 1, external_task_id: externalId }).eq("id", created.data.id).select("id,kind,status,progress,created_at,updated_at").single();
      if (updated.error) throw updated.error;
      return Response.json({ job: updated.data }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runway 任务创建失败";
      const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select("id,kind,status,progress,error_message,created_at,updated_at").single();
      if (failed.error) throw failed.error;
      return Response.json({ job: failed.data }, { status: 201 });
    }
  } catch (error) { return jsonError(error); }
}
