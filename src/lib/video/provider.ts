import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import { toUserMessage } from "@/lib/video/errors";
import { getRunwayTask, createRunwayTask } from "@/lib/video/runway";
import { createSeedanceTask, getSeedanceTask, type SeedanceStatus } from "@/lib/video/seedance";
import type { VideoJobInput } from "@/lib/video/types";
import { buildVideoPrompt } from "@/lib/video/prompts";

export { toUserMessage };

export const VOLCENGINE_MODEL = "doubao-seedance-2-0-260128";
export const RUNWAY_DEFAULT_MODEL = "gen4_turbo";

export type NormalizedTask = {
  status: "queued" | "generating" | "completed" | "failed";
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

export async function createProviderTask(config: ProviderRuntimeConfig, input: VideoJobInput, urls: string[]) {
  if (isArkProvider(config)) {
    const prompt = buildVideoPrompt(input);
    return createSeedanceTask(config, input, prompt, urls);
  }
  return createRunwayTask(config, input, urls);
}

export async function getProviderTask(config: ProviderRuntimeConfig, externalTaskId: string, currentProgress: number): Promise<NormalizedTask> {
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

export type { SeedanceStatus };
