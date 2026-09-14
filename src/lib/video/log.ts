import "server-only";

/**
 * 视频链路的结构化日志。字段固定，便于按 local job id / upstream task id 串联一次生成。
 * 绝不记录 API Key、Authorization、参考图签名 URL 或请求原文。
 */
export type VideoLogStage =
  | "create.start"
  | "create.ok"
  | "create.persist_failed"
  | "create.failed"
  | "poll.start"
  | "poll.ok"
  | "poll.failed"
  | "poll.persist_failed"
  | "poll.timed_out"
  | "poll.stranded_failed"
  | "recover.start"
  | "recover.adopted"
  | "recover.not_found"
  | "recover.failed"
  | "discard.user"
  | "save.start"
  | "save.ok"
  | "save.failed";

export type VideoLogFields = {
  jobId: string;
  stage?: VideoLogStage;
  provider?: string;
  upstreamTaskId?: string;
  idempotencyKey?: string;
  kind?: string;
  status?: string;
  providerStatus?: string;
  category?: string;
  attempt?: number;
  pollCount?: number;
  durationMs?: number;
  referenceImageCount?: number;
  persisted?: boolean;
  mayHaveCharged?: boolean;
  code?: string;
  /** 是否由用户显式点击「重新生成」触发；只有这种创建才允许产生新的付费任务。 */
  explicit?: boolean;
};

export function logVideoEvent(stage: VideoLogStage, fields: Omit<VideoLogFields, "stage">) {
  console.info("video_job", { stage, ...fields });
}
