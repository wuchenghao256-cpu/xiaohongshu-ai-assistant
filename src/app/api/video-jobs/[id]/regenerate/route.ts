import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { createProviderTask, toUserMessage } from "@/lib/video/provider";
import { videoJobInputSchema, withoutIdempotencyKey } from "@/lib/video/types";

/**
 * 重新生成是一个独立的付费任务，因此不能复用来源任务的幂等令牌。
 * 这里为每次调用生成新令牌，让并发重复点击回落到同一条记录（唯一索引保护）。
 */
const REUSABLE_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,created_at,updated_at,completed_at";

async function findByKey(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], userId: string, key: string) {
  const existing = await supabase.from("video_jobs").select(REUSABLE_COLUMNS).eq("user_id", userId).eq("idempotency_key", key).limit(1).maybeSingle();
  if (existing.error) return null;
  return existing.data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    // 同一次点击携带同一个令牌；重复点击会命中已有任务而不是再次扣费。
    const body = await request.json().catch(() => ({})) as { idempotencyKey?: string };
    const idempotencyKey = videoJobInputSchema.options[0].shape.idempotencyKey.safeParse(body.idempotencyKey).success && body.idempotencyKey
      ? body.idempotencyKey
      : crypto.randomUUID();
    const reused = await findByKey(supabase, user.id, idempotencyKey);
    if (reused) return Response.json({ job: reused }, { status: 200 });

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
      input_snapshot: withoutIdempotencyKey(input), idempotency_key: idempotencyKey,
    }).select(REUSABLE_COLUMNS).single();
    if (created.error) {
      if (created.error.code === "23505") return Response.json({ job: (await findByKey(supabase, user.id, idempotencyKey)) ?? created.data }, { status: 200 });
      throw created.error;
    }
    try {
      const externalTaskId = await createProviderTask(config, input, urls);
      const updated = await supabase.from("video_jobs").update({
        status: "generating", progress: 5, external_task_id: externalTaskId, submitted_at: new Date().toISOString(),
      }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      if (updated.error) {
        // 方舟任务已创建并计费，保留 task id 以便继续轮询。
        console.error("Failed to persist provider task id", { jobId: created.data.id, code: updated.error.code });
        return Response.json({ job: { ...created.data, status: "generating", progress: 5, external_task_id: externalTaskId } }, { status: 201 });
      }
      return Response.json({ job: updated.data }, { status: 201 });
    } catch (error) {
      const message = toUserMessage(error, "视频任务创建失败，请重试。");
      const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      if (failed.error) throw failed.error;
      return Response.json({ job: failed.data }, { status: 201 });
    }
  } catch (error) { return jsonError(error); }
}
