/**
 * 轮询节奏与超时的纯计算逻辑：不依赖任何运行期模块，便于直接用 node --test 验证。
 * 真正调用 Provider 的轮询流程位于 poll.ts。
 */

/** 轮询节奏：首次 5 秒，之后 10 / 15 秒，最大约 20-30 秒，避免每秒请求方舟。 */
const POLL_DELAYS_SECONDS = [5, 10, 15, 20, 25, 30] as const;
/** 超过该时长仍未完成则停止轮询并提示用户，防止无限查询。 */
export const POLL_TIMEOUT_MS = 45 * 60 * 1000;
/** 已入库但长时间没有 Provider 任务 ID 的记录视为提交中断。 */
const STRANDED_AFTER_MS = 3 * 60 * 1000;

export function pollDelaySeconds(attempts: number) {
  return POLL_DELAYS_SECONDS[Math.min(Math.max(attempts, 0), POLL_DELAYS_SECONDS.length - 1)];
}

export function isDueForPoll(lastPolledAt: string | null | undefined, attempts: number, now = Date.now()) {
  if (!lastPolledAt) return true;
  const last = Date.parse(lastPolledAt);
  if (Number.isNaN(last)) return true;
  return now - last >= pollDelaySeconds(attempts) * 1000;
}

export function hasPollingTimedOut(submittedAt: string | null | undefined, now = Date.now()) {
  if (!submittedAt) return false;
  const started = Date.parse(submittedAt);
  return !Number.isNaN(started) && now - started > POLL_TIMEOUT_MS;
}

/**
 * 任务已入库但从未拿到 Provider 任务 ID（例如服务端在提交过程中被中断）。
 * 这类任务永远不会被轮询，必须显式标记失败，否则会一直停留在“排队中”。
 */
export function isStrandedQueuedJob(job: { status: string; external_task_id: string | null; created_at: string }, now = Date.now()) {
  if (job.status !== "queued" || job.external_task_id) return false;
  const created = Date.parse(job.created_at);
  return !Number.isNaN(created) && now - created > STRANDED_AFTER_MS;
}
