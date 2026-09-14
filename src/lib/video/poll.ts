import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import { categorizePollError } from "@/lib/video/error-category";
import { logVideoEvent } from "@/lib/video/log";
import { hasPollingTimedOut } from "@/lib/video/poll-schedule";
import { getProviderTask, nextProgress, type NormalizedTask } from "@/lib/video/provider";

export { hasPollingTimedOut, isDueForPoll, isStrandedQueuedJob, pollDelaySeconds, POLL_TIMEOUT_MS } from "@/lib/video/poll-schedule";

export type PollableJob = {
  id: string;
  status: string;
  progress: number;
  provider: string;
  external_task_id: string | null;
  output_url: string | null;
  submitted_at: string | null;
  last_polled_at: string | null;
  poll_attempts: number;
};

export type JobChanges = {
  /**
   * 写回数据库的状态。Provider 明确返回「状态不可知」（百炼的 UNKNOWN）时不写 status：
   * 数据库的 media_job_status 枚举没有这一项，而把未知状态硬塞成 completed/failed
   * 会让一个可能仍在计费的任务被当成终态，从此不再轮询。
   */
  status?: "queued" | "generating" | "completed" | "failed";
  progress: number;
  provider_status?: string;
  provider_meta?: Record<string, string | number>;
  output_url?: string | null;
  error_message?: string | null;
  completed_at?: string | null;
  last_polled_at: string;
  poll_attempts: number;
};

/**
 * 查询一个未完成的视频任务并返回需要写回的字段。
 * 这里只负责状态收敛；页面刷新后仍会走同一路径，因此刷新不会丢任务。
 *
 * 只会 GET，从不创建。查询失败只记录并保持当前状态，交给下一轮继续查询，
 * 绝不会因为一次查询失败而重新创建付费任务。
 */
export async function pollVideoJob(config: ProviderRuntimeConfig, job: PollableJob): Promise<JobChanges | null> {
  const base = {
    last_polled_at: new Date().toISOString(),
    // 该字段受 check 约束限制在 0-1000，达到上限后停止累加，避免写库失败。
    poll_attempts: Math.min(job.poll_attempts + 1, 1000),
    status: job.status as JobChanges["status"],
    progress: job.progress,
  };

  if (!job.external_task_id) return null;

  const startedAt = Date.now();
  logVideoEvent("poll.start", { jobId: job.id, provider: job.provider, upstreamTaskId: job.external_task_id, pollCount: job.poll_attempts + 1 });

  if (hasPollingTimedOut(job.submitted_at)) {
    logVideoEvent("poll.timed_out", { jobId: job.id, provider: job.provider, upstreamTaskId: job.external_task_id, pollCount: job.poll_attempts + 1, durationMs: Date.now() - startedAt });
    return { ...base, status: "failed", progress: job.progress, error_message: "视频生成超时，请重新生成。" };
  }

  let remote: NormalizedTask;
  try {
    remote = await getProviderTask(config, job.external_task_id, job.progress);
  } catch (error) {
    // 单次查询失败不判定任务失败，交给下一轮轮询继续尝试；只记录错误分类，不记录响应原文。
    const category = categorizePollError(error);
    logVideoEvent("poll.failed", { jobId: job.id, provider: job.provider, upstreamTaskId: job.external_task_id, category, pollCount: job.poll_attempts + 1, durationMs: Date.now() - startedAt });
    return base;
  }

  const progress = nextProgress(job.progress, remote);
  const trace = { jobId: job.id, provider: job.provider, upstreamTaskId: job.external_task_id, providerStatus: remote.providerStatus, pollCount: job.poll_attempts + 1, durationMs: Date.now() - startedAt };
  if (remote.status === "completed") {
    if (!remote.outputUrl) {
      logVideoEvent("poll.ok", { ...trace, status: "failed" });
      return { ...base, status: "failed", progress: 100, error_message: "视频生成完成但没有返回可用地址，请重试。" };
    }
    logVideoEvent("poll.ok", { ...trace, status: "completed" });
    return {
      ...base,
      status: "completed",
      progress: 100,
      provider_status: remote.providerStatus,
      provider_meta: remote.meta,
      output_url: remote.outputUrl,
      error_message: null,
      completed_at: new Date().toISOString(),
    };
  }
  if (remote.status === "failed") {
    logVideoEvent("poll.ok", { ...trace, status: "failed" });
    return { ...base, status: "failed", progress, provider_status: remote.providerStatus, error_message: remote.errorMessage ?? "视频生成失败，请重试。" };
  }
  // 状态不可知（百炼 UNKNOWN：任务不存在或超出 24 小时查询窗口）。
  // 保留原状态继续轮询，只把 Provider 的原话记进 provider_status 便于排查。
  // 45 分钟的总超时仍会兜底收敛，因此不会有任务永远挂着。
  if (remote.status === "unknown") {
    logVideoEvent("poll.ok", { ...trace, status: "unknown" });
    return { ...base, provider_status: remote.providerStatus, provider_meta: remote.meta };
  }
  logVideoEvent("poll.ok", { ...trace, status: remote.status });
  return { ...base, status: remote.status, progress, provider_status: remote.providerStatus, provider_meta: remote.meta };
}
