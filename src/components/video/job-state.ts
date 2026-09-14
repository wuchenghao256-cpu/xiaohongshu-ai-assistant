/**
 * 视频任务在前端的状态收敛逻辑：不依赖 React，便于直接用 node --test 验证。
 *
 * 这里承载两条防重复扣费的规则：
 * 1. 只有服务端明确返回的终态才停止轮询；未知状态必须继续轮询（不能当成 failed）。
 * 2. 刷新返回的数据不会覆盖本地正在处理的状态，避免"提交成功但刷新把它打回失败"。
 */
// 仅类型导入：strip-types 会把它整条删除，因此这里既能做编译期校验，又不给
// node --test 增加任何运行期依赖（项目的测试脚本没有 @/ 别名解析）。
import type { VideoJobStatus } from "@/lib/video/types";

/**
 * 状态文案。键必须与 lib/video/types.ts 的 videoJobStatusLabels 完全一致：
 * 下方的 ExhaustiveStatuses 会在两边漂移时直接报编译错误。
 */
const statusLabels: Record<VideoJobStatus | "preparing", string> = {
  preparing: "准备中",
  queued: "排队中",
  generating: "生成中",
  completed: "完成",
  failed: "失败",
  never_accepted: "未提交",
};

type ExhaustiveStatuses = keyof typeof statusLabels extends VideoJobStatus | "preparing" ? true : never;
const _statusesAreExhaustive: ExhaustiveStatuses = true;
void _statusesAreExhaustive;

export type VideoJob = {
  id: string;
  kind: "image_to_video" | "product_ad" | "product_ugc";
  status: VideoJobStatus | (string & {});
  progress: number;
  output_url?: string | null;
  error_message?: string | null;
  provider_status?: string | null;
  created_at: string;
  saved?: boolean;
  /** 本地推断：任务已入库但迟迟拿不到上游 task id，需要用户确认后再决定。 */
  recover?: boolean;
};

/** 只有这两个状态需要继续轮询。 */
export function shouldKeepPolling(job: VideoJob) {
  return job.status === "queued" || job.status === "generating";
}

/** 服务端返回了本地还不认识的状态时，不能当作终态处理。 */
export function isUnknownJobStatus(status: string): boolean {
  return !(status in statusLabels);
}

/** 取状态文案；未知状态不要显示 "undefined"。 */
export function jobStatusLabel(status: string) {
  return (statusLabels as Record<string, string | undefined>)[status] ?? "同步中";
}

/**
 * 合并服务端返回的列表与本地已有的列表。
 * 本地有、服务端没返回的记录会被保留 —— 分页上限（12 条）不该让刚创建的任务消失。
 * 同一 id 以服务端数据为准，但 `recover` 是本地推断的标志，不能被覆盖掉。
 */
export function dedupeJobs(incoming: VideoJob[], current: VideoJob[]): VideoJob[] {
  const byId = new Map<string, VideoJob>();
  for (const job of current) byId.set(job.id, job);
  const order: string[] = current.map((job) => job.id);
  for (const job of incoming) {
    if (!byId.has(job.id)) order.push(job.id);
    const previous = byId.get(job.id);
    byId.set(job.id, previous ? { ...previous, ...job, recover: job.recover ?? previous.recover } : job);
  }
  return order.map((id) => byId.get(id)).filter((job): job is VideoJob => Boolean(job));
}

/** 只更新指定任务的字段，其余记录原样保留。 */
export function patchJob(jobs: VideoJob[], job: VideoJob, extra: Partial<VideoJob> = {}): VideoJob[] {
  return jobs.map((item) => (item.id === job.id ? { ...item, ...job, ...extra } : item));
}

/** 任务已入库但超过这个时长仍没有上游 task id：给用户一个确认/关闭的入口。 */
export const RECOVERABLE_AFTER_MS = 4 * 60 * 1000;

export type RecoverableJob = VideoJob;
export type UnknownJob = VideoJob;

export function markRecoverable(jobs: VideoJob[], now = Date.now()): VideoJob[] {
  return jobs.map((job) => {
    if (job.status !== "queued" || job.recover) return job;
    const created = Date.parse(job.created_at);
    if (Number.isNaN(created)) return job;
    return now - created > RECOVERABLE_AFTER_MS ? { ...job, recover: true } : job;
  });
}

/** 上一轮已经完成/失败，新任务已排在前面时，旧记录折叠起来不再占用注意力。 */
export const COLLAPSE_AFTER_JOBS = 3;

export function visibleJobs(jobs: VideoJob[], limit = COLLAPSE_AFTER_JOBS) {
  return { visible: jobs.slice(0, limit), hidden: Math.max(0, jobs.length - limit) };
}
