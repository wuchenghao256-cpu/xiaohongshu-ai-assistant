import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
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
  status: "queued" | "generating" | "completed" | "failed";
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

  if (hasPollingTimedOut(job.submitted_at)) {
    return { ...base, status: "failed", progress: job.progress, error_message: "视频生成超时，请重新生成。" };
  }

  let remote: NormalizedTask;
  try {
    remote = await getProviderTask(config, job.external_task_id, job.progress);
  } catch (error) {
    // 单次查询失败不判定任务失败，交给下一轮轮询继续尝试；只记录错误码，不记录响应原文。
    console.error("Video task poll failed", { jobId: job.id, code: error instanceof Error ? error.name : "unknown" });
    return base;
  }

  const progress = nextProgress(job.progress, remote);
  if (remote.status === "completed") {
    if (!remote.outputUrl) {
      return { ...base, status: "failed", progress: 100, error_message: "视频生成完成但没有返回可用地址，请重试。" };
    }
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
    return { ...base, status: "failed", progress, provider_status: remote.providerStatus, error_message: remote.errorMessage ?? "视频生成失败，请重试。" };
  }
  return { ...base, status: remote.status, progress, provider_status: remote.providerStatus, provider_meta: remote.meta };
}
