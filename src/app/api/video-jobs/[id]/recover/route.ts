import { jsonError } from "@/lib/http";
import { getEnabledProviderConfig } from "@/lib/providers/repository";
import { requireUser } from "@/lib/supabase/auth";
import { categorizePollError } from "@/lib/video/error-category";
import { logVideoEvent } from "@/lib/video/log";
import { getProviderTask } from "@/lib/video/provider";

const JOB_COLUMNS = "id,kind,status,progress,provider,external_task_id,input_snapshot,output_url,error_message,provider_status,provider_meta,submitted_at,last_polled_at,poll_attempts,created_at,updated_at,completed_at";

/** 客户端提交的令牌本来就是 UUID；只有这种形状才允许拿去当上游任务 ID 反查。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 补记上游任务 ID。
 *
 * 触发场景：创建请求实际上已经在方舟成功创建并计费，但本地响应丢失（超时 / 5xx /
 * 函数被回收），导致 video_jobs 里只有一条没有 external_task_id 的记录。
 *
 * 恢复有两条路径，按顺序尝试：
 *   1. 自动：把本地 job id 当作上游任务 ID 直接查询。这只是对「本地 id 恰好等于
 *      上游 id」的乐观尝试，查到就自动补记，用户什么都不用做。
 *   2. 手动：用户在生成服务控制台找到任务后把 task id 填进来。
 *
 * 这里只写数据库，不调用任何创建接口 —— 恢复任务永远不会再产生一次扣费。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { externalTaskId?: unknown };
    const manual = typeof body.externalTaskId === "string" ? body.externalTaskId.trim() : "";
    if (manual && (manual.length < 3 || manual.length > 200)) {
      return Response.json({ error: "请填写正确的任务 ID（形如 cgt-...）。" }, { status: 400 });
    }

    const { user, supabase } = await requireUser();
    const current = await supabase.from("video_jobs").select("id,status,external_task_id,provider").eq("id", id).single();
    if (current.error) return Response.json({ error: "视频任务不存在。" }, { status: 404 });
    if (current.data.external_task_id) {
      return Response.json({ error: "该任务已经有关联的上游任务 ID，无需恢复。" }, { status: 400 });
    }
    if (current.data.status !== "failed" && current.data.status !== "queued") {
      return Response.json({ error: "只有提交失败或仍在排队的任务可以恢复。" }, { status: 400 });
    }

    const config = await getEnabledProviderConfig(user.id, "video");
    if (!config) return Response.json({ error: "请先在系统设置 → 视频模型中启用视频 Provider。" }, { status: 400 });

    // 手动填写的 ID 优先；否则用本地 job id 做一次乐观反查（仅当它看起来像上游 ID）。
    const candidates = manual ? [manual] : UUID_PATTERN.test(id) ? [id] : [];
    if (!candidates.length) return Response.json({ error: "请填写生成服务里的任务 ID。" }, { status: 400 });

    const startedAt = Date.now();
    logVideoEvent("recover.start", { jobId: id, provider: current.data.provider, explicit: Boolean(manual) });

    let found: { upstreamTaskId: string; normalized: Awaited<ReturnType<typeof getProviderTask>> } | null = null;
    let lastCategory: ReturnType<typeof categorizePollError> | undefined;
    for (const candidate of candidates) {
      try {
        found = { upstreamTaskId: candidate, normalized: await getProviderTask(config, candidate, 0) };
        break;
      } catch (error) {
        lastCategory = categorizePollError(error);
      }
    }
    if (!found) {
      logVideoEvent("recover.not_found", { jobId: id, provider: current.data.provider, category: lastCategory, durationMs: Date.now() - startedAt });
      // 自动反查失败不等于任务不存在，所以文案要同时给出两条出路。
      return Response.json({
        error: manual
          ? "在生成服务里查询不到这个任务 ID，请确认后重试。"
          : "没有自动找到对应的生成任务。请到生成服务控制台按任务 ID 查询，找到后把任务 ID 填进来。",
      }, { status: 404 });
    }

    const { upstreamTaskId, normalized } = found;
    const now = new Date().toISOString();
    const changes = normalized.status === "completed" && normalized.outputUrl
      ? { status: "completed" as const, progress: 100, output_url: normalized.outputUrl, error_message: null, provider_status: normalized.providerStatus, provider_meta: normalized.meta, completed_at: now }
      : normalized.status === "failed"
        ? { status: "failed" as const, progress: 100, error_message: normalized.errorMessage ?? "视频生成失败，请重试。", provider_status: normalized.providerStatus }
        : { status: normalized.status, progress: Math.max(5, normalized.progress), error_message: null, provider_status: normalized.providerStatus, provider_meta: normalized.meta };

    const updated = await supabase.from("video_jobs").update({
      ...changes,
      external_task_id: upstreamTaskId,
      // 重新开始 45 分钟总超时计时，否则一个两天前的任务一恢复就立刻被判超时。
      submitted_at: now,
      last_polled_at: now,
    }).eq("id", id).select(JOB_COLUMNS).single();
    if (updated.error) {
      logVideoEvent("recover.failed", { jobId: id, provider: current.data.provider, upstreamTaskId, code: updated.error.code });
      throw updated.error;
    }

    logVideoEvent("recover.adopted", { jobId: id, provider: current.data.provider, upstreamTaskId, status: changes.status, explicit: Boolean(manual), durationMs: Date.now() - startedAt });
    const saved = await supabase.from("video_assets").select("id").eq("video_job_id", id).maybeSingle();
    // 把服务端权威状态原样返回给前端覆盖本地：如果这个任务其实已经结束，
    // 前端必须立刻停止轮询，而不是继续每 8 秒请求一次。
    return Response.json({ job: { ...updated.data, saved: Boolean(saved.data), recover: false } });
  } catch (error) { return jsonError(error); }
}
