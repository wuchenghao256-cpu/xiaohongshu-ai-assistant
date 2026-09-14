import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { categorizeCreateError, CREATE_TIMEOUT_USER_MESSAGE, CREATE_UNKNOWN_USER_MESSAGE, mayHaveCreatedUpstream, withRecoveryHint } from "@/lib/video/error-category";
import { logVideoEvent } from "@/lib/video/log";
import { createProviderTask, toUserMessage } from "@/lib/video/provider";
import { videoJobInputSchema, withoutIdempotencyKey } from "@/lib/video/types";

/**
 * 重新生成是唯一允许创建第二个付费任务的入口，必须由用户显式点击触发
 * （前端还会再弹一次确认）。这里每次调用生成新令牌，让并发重复点击回落到
 * 同一条记录（唯一索引保护），并保留来源任务的参考图批次。
 *
 * 已知限制（本轮审计确认）：创建请求超时时，本地拿不到新任务的 upstream id，
 * 「恢复任务」只能作用在数据库里已有 ID 的记录上，因此这条新记录无法对账。
 * 前端对超时给出明确提示；要彻底闭环需要在 video_jobs 上保存幂等令牌再做
 * 上游对账查询，属于下一轮工作。
 */
const REUSABLE_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,provider_status,provider_meta,submitted_at,last_polled_at,poll_attempts,created_at,updated_at,completed_at";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

async function findByKey(supabase: Supabase, userId: string, key: string) {
  const existing = await supabase.from("video_jobs").select(REUSABLE_COLUMNS).eq("user_id", userId).eq("idempotency_key", key).limit(1).maybeSingle();
  if (existing.error) return null;
  return existing.data;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, supabase } = await requireUser();
    const body = await request.json().catch(() => ({})) as { idempotencyKey?: unknown };
    const candidate = typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;
    const parsed = candidate ? videoJobInputSchema.options[0].shape.idempotencyKey.safeParse(candidate) : null;
    const idempotencyKey = parsed?.success && candidate ? candidate : crypto.randomUUID();

    const reused = await findByKey(supabase, user.id, idempotencyKey);
    if (reused) return Response.json({ job: reused }, { status: 200 });

    const source = await supabase.from("video_jobs").select("input_snapshot").eq("id", id).single();
    if (source.error) return Response.json({ error: "原视频任务不存在。" }, { status: 404 });
    const input = videoJobInputSchema.parse(source.data.input_snapshot);
    const config = await getEnabledProviderConfig(user.id, "video");
    if (!config) return Response.json({ error: "请先在系统设置 → 视频模型中启用视频 Provider。" }, { status: 400 });

    const created = await supabase.from("video_jobs").insert({
      user_id: user.id, kind: input.kind, status: "queued", progress: 0, provider: config.provider,
      input_snapshot: withoutIdempotencyKey(input), idempotency_key: idempotencyKey,
    }).select(REUSABLE_COLUMNS).single();
    if (created.error) {
      if (created.error.code === "23505") return Response.json({ job: (await findByKey(supabase, user.id, idempotencyKey)) ?? created.data }, { status: 200 });
      throw created.error;
    }

    const startedAt = Date.now();
    logVideoEvent("create.start", { jobId: created.data.id, provider: config.provider, kind: input.kind, idempotencyKey, referenceImageCount: input.inputPaths.length, explicit: true });
    try {
      const urls = await Promise.all(input.inputPaths.map(async (path) => {
        const signed = await supabase.storage.from("product-assets").createSignedUrl(path, 86400);
        if (signed.error) throw signed.error;
        return signed.data.signedUrl;
      }));
      const externalTaskId = await createProviderTask(config, input, urls);
      const updated = await supabase.from("video_jobs").update({
        status: "generating", progress: 5, external_task_id: externalTaskId, submitted_at: new Date().toISOString(),
      }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      logVideoEvent("create.ok", { jobId: created.data.id, provider: config.provider, upstreamTaskId: externalTaskId, explicit: true, durationMs: Date.now() - startedAt, persisted: !updated.error });
      if (updated.error) {
        // 方舟任务已创建并计费，但本地写入失败。返回失败状态而不是假装 generating：
        // 数据库里这条记录没有 external_task_id，刷新后不会有人去轮询它。
        logVideoEvent("create.persist_failed", { jobId: created.data.id, provider: config.provider, upstreamTaskId: externalTaskId, code: updated.error.code });
        return Response.json({
          job: {
            ...created.data,
            status: "failed",
            progress: 5,
            external_task_id: null,
            error_message: "视频任务已在生成服务中创建，但本地保存失败。请点「恢复任务」按下方任务 ID 找回，不要重新提交以免重复计费。",
          },
        }, { status: 201 });
      }
      return Response.json({ job: updated.data }, { status: 201 });
    } catch (error) {
      const category = categorizeCreateError(error);
      const message = category === "timeout" || category === "unknown"
        ? (category === "timeout" ? CREATE_TIMEOUT_USER_MESSAGE : CREATE_UNKNOWN_USER_MESSAGE)
        : withRecoveryHint(toUserMessage(error, "视频任务创建失败。"), category);
      const failed = await supabase.from("video_jobs").update({ status: "failed", error_message: message }).eq("id", created.data.id).select(REUSABLE_COLUMNS).single();
      logVideoEvent("create.failed", { jobId: created.data.id, provider: config.provider, category, mayHaveCharged: mayHaveCreatedUpstream(category), explicit: true, durationMs: Date.now() - startedAt });
      if (failed.error) {
        // 连失败状态都写不进去时，至少把记录返回给用户，让它在列表里可见。
        return Response.json({ job: { ...created.data, status: "failed", error_message: message } }, { status: 201 });
      }
      return Response.json({ job: failed.data }, { status: 201 });
    }
  } catch (error) { return jsonError(error); }
}
