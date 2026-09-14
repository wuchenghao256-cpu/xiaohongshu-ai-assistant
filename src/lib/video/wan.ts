import "server-only";
import { withExponentialRetry } from "@/lib/jobs/orchestrator";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import type { VideoJobInput } from "@/lib/video/types";
import {
  buildWanRequestBody,
  mapWanError,
  mapWanStatus,
  resolveWanBaseUrl,
  shouldRetryWanCreate,
  shouldRetryWanQuery,
  wanFailureMessage,
  WanError,
  type WanStatus,
} from "@/lib/video/wan-mapping";

/**
 * 阿里云百炼（Model Studio / DashScope）Wan2.7 图生视频适配器。
 *
 * 官方异步接口：
 *   POST /api/v1/services/aigc/video-generation/video-synthesis  创建任务，返回 output.task_id
 *   GET  /api/v1/tasks/{task_id}                                  查询状态与结果
 *
 * 华北2（北京）的 Endpoint 是业务空间专属域名：
 *   https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com
 * 业务空间 ID 由调用方在服务端解析后传入 config.workspaceId；缺少时退回通用域名。
 *
 * 只有 API Key 鉴权，且密钥只存在于服务端。纯映射逻辑（请求体、状态、错误文案）
 * 位于 wan-mapping.ts。
 */

const CREATE_TIMEOUT_MS = 90_000;
const QUERY_TIMEOUT_MS = 20_000;

export { mapWanStatus, resolveWanBaseUrl, WanError } from "@/lib/video/wan-mapping";
export type { WanStatus } from "@/lib/video/wan-mapping";

export type WanTask = {
  id: string;
  /** 系统统一状态；百炼原始状态放在 providerStatus 中，不直接出现在 UI。 */
  status: WanStatus;
  providerStatus: string;
  progress: number;
  videoUrl?: string;
  errorMessage?: string;
  /** 允许持久化的调试信息，绝不包含 API Key、Authorization 或请求原文。 */
  meta: Record<string, string | number>;
};

/**
 * 创建任务时**只**对限流做重试，理由与方舟一致：视频任务很贵，创建请求超时或返回
 * 5xx 时都无法确定百炼是否已经受理并计费，重发会造成一次点击两条付费任务。
 * 重试策略（shouldRetryWanCreate / shouldRetryWanQuery）定义在 wan-mapping.ts，便于直接测试。
 */
async function wanFetch(
  config: ProviderRuntimeConfig,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  shouldRetry: (error: unknown) => boolean,
) {
  const base = resolveWanBaseUrl({ baseUrl: config.baseUrl, workspaceId: config.workspaceId, region: config.region });
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
      if (!response.ok) throw mapWanError(response.status, payload);
      return payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof WanError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new WanError("阿里云百炼响应超时，请稍后在任务列表中查看结果。", "WAN_TIMEOUT", 504);
      }
      throw new WanError("无法连接阿里云百炼，请稍后重试。", "WAN_UNREACHABLE", 502);
    } finally {
      clearTimeout(timer);
    }
  }, shouldRetry, { maxAttempts: 3, baseDelayMs: 800 });
}

/** 异步提交必须显式声明，否则百炼会按同步接口处理并直接超时。 */
function asyncHeaders() {
  return { "X-DashScope-Async": "enable" };
}

/** 创建视频任务，返回百炼任务 ID（形如 UUID）。 */
export async function createWanTask(config: ProviderRuntimeConfig, input: VideoJobInput, prompt: string, urls: string[]) {
  const payload = await wanFetch(config, "/api/v1/services/aigc/video-generation/video-synthesis", {
    method: "POST",
    headers: asyncHeaders(),
    body: JSON.stringify(buildWanRequestBody(config, input, prompt, urls)),
  }, CREATE_TIMEOUT_MS, shouldRetryWanCreate);
  const output = payload.output as Record<string, unknown> | undefined;
  const id = typeof output?.task_id === "string" ? output.task_id : undefined;
  // 没有 task_id 就说明本地拿不到对账依据，绝不能当成创建成功继续轮询。
  if (!id) throw new WanError("阿里云百炼没有返回任务 ID，请稍后重试。", "WAN_INVALID_RESPONSE", 502);
  return id;
}

export async function getWanTask(config: ProviderRuntimeConfig, id: string, currentProgress = 0): Promise<WanTask> {
  const payload = await wanFetch(config, `/api/v1/tasks/${encodeURIComponent(id)}`, { method: "GET" }, QUERY_TIMEOUT_MS, shouldRetryWanQuery);
  const output = payload.output as Record<string, unknown> | undefined;
  const providerStatus = typeof output?.task_status === "string" ? output.task_status : "UNKNOWN";
  const status = mapWanStatus(providerStatus);
  // 临时地址有效期 24 小时，只用于转存；前端展示的永远是 Supabase 永久地址。
  const videoUrl = typeof output?.video_url === "string" && output.video_url.length ? output.video_url : undefined;
  return {
    id,
    status,
    providerStatus,
    progress: progressFor(status, currentProgress),
    videoUrl,
    errorMessage: status === "failed" ? wanFailureMessage(providerStatus, payload) : undefined,
    meta: {
      providerStatus,
      // 保留百炼的 request_id，出问题时可据此向阿里云提单，且不含任何密钥。
      ...(typeof payload.request_id === "string" ? { requestId: payload.request_id } : {}),
    },
  };
}

/** 百炼不返回百分比进度。这里按轮询阶段给出单调递增的估算值，不虚构精确进度。 */
function progressFor(status: WanStatus, current: number) {
  if (status === "completed") return 100;
  if (status === "queued") return Math.max(current, 5);
  // unknown 不推进进度：状态不可知时不该让用户以为任务在往前走。
  if (status === "unknown") return current;
  return Math.min(Math.max(current + 8, 20), 92);
}

/** 供单元测试与错误分类使用。 */
export { buildWanRequestBody, mapWanError, wanFailureMessage };
