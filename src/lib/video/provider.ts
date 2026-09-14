import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import { toUserMessage } from "@/lib/video/errors";
import { getRunwayTask, createRunwayTask } from "@/lib/video/runway";
import { createSeedanceTask, getSeedanceTask, type SeedanceStatus } from "@/lib/video/seedance";
import type { VideoJobInput } from "@/lib/video/types";
import { buildVideoPrompt } from "@/lib/video/prompts";
import { createWanTask, getWanTask, type WanStatus } from "@/lib/video/wan";

export { toUserMessage };

export const VOLCENGINE_MODEL = "doubao-seedance-2-0-260128";
export const RUNWAY_DEFAULT_MODEL = "gen4_turbo";
export const ALIBABA_WAN_MODEL = "wan2.7-i2v-2026-04-25";

export type NormalizedTask = {
  /**
   * `unknown` 表示 Provider 明确返回了「状态不可知」（百炼任务不存在或超出 24 小时查询窗口）。
   * 它既不是完成也不是失败，轮询链路必须原样透传，不能替用户判定任务已经结束。
   */
  status: "queued" | "generating" | "completed" | "failed" | "unknown";
  progress: number;
  providerStatus?: string;
  outputUrl?: string;
  errorMessage?: string;
  meta?: Record<string, string | number>;
};

/** 只有火山方舟走 Seedance 2.0；Runway adapter 保留并继续可用，但不再作为默认 Provider。 */
export function isArkProvider(config: ProviderRuntimeConfig) {
  return config.provider === "volcengine";
}

/** 阿里云百炼走 Wan2.7 新版异步图生视频协议。 */
export function isWanProvider(config: ProviderRuntimeConfig) {
  return config.provider === "alibaba";
}

export async function createProviderTask(config: ProviderRuntimeConfig, input: VideoJobInput, urls: string[]) {
  if (isWanProvider(config)) {
    // 复用现有视频 Prompt 与商品保真约束，不另起一套。
    return createWanTask(config, input, buildVideoPrompt(input), urls);
  }
  if (isArkProvider(config)) {
    const prompt = buildVideoPrompt(input);
    return createSeedanceTask(config, input, prompt, urls);
  }
  return createRunwayTask(config, input, urls);
}

export async function getProviderTask(config: ProviderRuntimeConfig, externalTaskId: string, currentProgress: number): Promise<NormalizedTask> {
  if (isWanProvider(config)) {
    const task = await getWanTask(config, externalTaskId, currentProgress);
    return {
      status: task.status,
      progress: task.progress,
      providerStatus: task.providerStatus,
      outputUrl: task.videoUrl,
      errorMessage: task.errorMessage,
      meta: task.meta,
    };
  }
  if (isArkProvider(config)) {
    const task = await getSeedanceTask(config, externalTaskId, currentProgress);
    return {
      status: task.status,
      progress: task.progress,
      providerStatus: task.providerStatus,
      outputUrl: task.videoUrl,
      errorMessage: task.errorMessage,
      meta: task.meta,
    };
  }
  return normalizeRunwayTask(await getRunwayTask(config, externalTaskId));
}

/** 把各 Provider 的原始状态映射成系统统一状态，UI 不接触 Provider 原始字段。 */
export function normalizeRunwayTask(remote: Record<string, unknown>): NormalizedTask {
  const raw = String(remote.status ?? "").toUpperCase();
  const progressValue = typeof remote.progress === "number" ? Math.round(remote.progress <= 1 ? remote.progress * 100 : remote.progress) : undefined;
  const output = Array.isArray(remote.output) && typeof remote.output[0] === "string" ? remote.output[0] : undefined;
  const status = raw === "SUCCEEDED" ? "completed" : ["FAILED", "CANCELED", "CANCELLED"].includes(raw) ? "failed" : raw === "PENDING" || raw === "QUEUED" ? "queued" : "generating";
  return {
    status,
    progress: status === "completed" ? 100 : progressValue ?? (status === "queued" ? 5 : 20),
    providerStatus: raw,
    outputUrl: output,
    errorMessage: status === "failed" ? String(remote.failure ?? remote.failureCode ?? "视频生成失败，请重试。") : undefined,
  };
}

/** 方舟状态机收敛：progress 只允许前进，避免刷新后用旧值覆盖新进度。 */
export function nextProgress(current: number, task: NormalizedTask) {
  if (task.status === "completed") return 100;
  return Math.max(current, task.progress);
}

export type { SeedanceStatus, WanStatus };
