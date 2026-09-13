import "server-only";
import { withExponentialRetry } from "@/lib/jobs/orchestrator";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import {
  buildSeedanceRequestBody,
  failureMessage,
  mapSeedanceError,
  mapSeedanceStatus,
  SeedanceError,
  shouldRetryCreate,
  shouldRetryQuery,
  type SeedanceStatus,
} from "@/lib/video/seedance-mapping";
import type { VideoJobInput } from "@/lib/video/types";

/**
 * 火山方舟 Seedance 2.0 视频生成适配器。
 *
 * 官方接口（https://ark.cn-beijing.volces.com/api/v3）：
 *   POST /contents/generations/tasks       创建异步任务，返回 { id: "cgt-..." }
 *   GET  /contents/generations/tasks/{id}  查询任务状态与结果
 *
 * 只有 API Key 鉴权，不接受 OpenAI-compatible 视频接口。
 * 纯映射逻辑（请求体、状态、错误文案）位于 seedance-mapping.ts。
 */

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const CREATE_TIMEOUT_MS = 90_000;
const QUERY_TIMEOUT_MS = 20_000;

export { buildSeedanceContent, mapSeedanceError, mapSeedanceStatus, SeedanceError } from "@/lib/video/seedance-mapping";
export type { SeedanceStatus } from "@/lib/video/seedance-mapping";

export type SeedanceTask = {
  id: string;
  /** 系统统一状态；方舟原始状态只放在 providerStatus 中，不直接出现在 UI。 */
  status: SeedanceStatus;
  providerStatus: string;
  progress: number;
  videoUrl?: string;
  errorMessage?: string;
  /** 允许持久化的调试信息，绝不包含 API Key、Authorization 或请求原文。 */
  meta: Record<string, string | number>;
};

/**
 * 创建任务时**只**对限流做重试。视频任务很贵，创建请求超时或返回 5xx 时都无法确定
 * 方舟是否已经受理并计费，因此一律不重试，避免一次点击产生两条付费任务。
 * 重试策略（shouldRetryCreate / shouldRetryQuery）定义在 seedance-mapping.ts，便于直接测试。
 */

async function arkFetch(config: ProviderRuntimeConfig, path: string, init: RequestInit, timeoutMs: number, shouldRetry: (error: unknown) => boolean) {
  const base = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return withExponentialRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw mapSeedanceError(response.status, payload);
      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SeedanceError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SeedanceError("火山方舟响应超时，请稍后在任务列表中查看结果。", "ARK_TIMEOUT", 504);
      }
      throw new SeedanceError("无法连接火山方舟，请稍后重试。", "ARK_UNREACHABLE", 502);
    } finally {
      clearTimeout(timer);
    }
  }, shouldRetry, { maxAttempts: 3, baseDelayMs: 800 });
}

/** 创建视频任务，返回方舟任务 ID（形如 cgt-...）。 */
export async function createSeedanceTask(config: ProviderRuntimeConfig, input: VideoJobInput, prompt: string, urls: string[]) {
  const payload = await arkFetch(config, "/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(buildSeedanceRequestBody(config, input, prompt, urls)),
  }, CREATE_TIMEOUT_MS, shouldRetryCreate);
  const id = typeof payload.id === "string" ? payload.id : undefined;
  if (!id) throw new SeedanceError("火山方舟没有返回任务 ID，请稍后重试。", "ARK_INVALID_RESPONSE", 502);
  return id;
}

function nestedString(payload: Record<string, unknown>, key: string) {
  const content = payload.content as Record<string, unknown> | undefined;
  const value = content?.[key];
  return typeof value === "string" && value.length ? value : undefined;
}

export async function getSeedanceTask(config: ProviderRuntimeConfig, id: string, currentProgress = 0): Promise<SeedanceTask> {
  const payload = await arkFetch(config, `/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "GET" }, QUERY_TIMEOUT_MS, shouldRetryQuery);
  const providerStatus = typeof payload.status === "string" ? payload.status : "unknown";
  const status = mapSeedanceStatus(providerStatus);
  const usage = payload.usage as Record<string, unknown> | undefined;
  const tokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  return {
    id,
    status,
    providerStatus,
    progress: progressFor(status, currentProgress),
    videoUrl: nestedString(payload, "video_url"),
    errorMessage: status === "failed" ? failureMessage(providerStatus, payload) : undefined,
    meta: {
      providerStatus,
      ...(tokens ? { completionTokens: tokens } : {}),
      ...(typeof payload.resolution === "string" ? { resolution: payload.resolution } : {}),
      ...(typeof payload.ratio === "string" ? { ratio: payload.ratio } : {}),
    },
  };
}

/** 方舟不返回百分比进度。这里按轮询阶段给出单调递增的估算值，不虚构精确进度。 */
function progressFor(status: SeedanceStatus, current: number) {
  if (status === "completed") return 100;
  if (status === "queued") return Math.max(current, 5);
  return Math.min(Math.max(current + 8, 20), 92);
}
