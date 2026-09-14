import type { ProviderRuntimeConfig } from "@/lib/providers/types";
import type { VideoJobInput } from "@/lib/video/types";

/**
 * 阿里云百炼（Model Studio / DashScope）Wan2.7 图生视频的纯映射逻辑：
 * 请求体组装、状态映射与错误翻译。这里不引入任何运行期依赖，
 * 便于直接用 node --test 验证；网络与重试逻辑位于 wan.ts。
 *
 * 官方异步协议：
 *   POST /api/v1/services/aigc/video-generation/video-synthesis
 *   GET  /api/v1/tasks/{task_id}
 * 创建必须带 `X-DashScope-Async: enable`，否则会退化成同步接口。
 */

export type WanStatus = "queued" | "generating" | "completed" | "failed" | "unknown";

export class WanError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status = 502) {
    super(message);
    this.name = "WanError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 百炼的华北2（北京）Endpoint 是「业务空间专属域名」：
 * `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`。
 *
 * 这个格式已实测确认：传一个不存在的业务空间 ID 访问该域名，服务端会返回
 * `400 BadRequest.IllegalEndpoint / "Workspace endpoint is invalid."`，
 * 说明路由本身存在，只有业务空间 ID 需要填对。
 *
 * 但 `dashscope.cn-beijing.aliyuncs.com` 这种「北京通用域名」实测不可用，
 * 因此缺少业务空间 ID 时退回**已验证可用**的共享域名 `dashscope.aliyuncs.com`
 * （实测返回标准 JSON：`401 {"code":"InvalidApiKey"}`），而不是一个连不上的主机。
 */
export const WAN_BEIJING_SUFFIX = "cn-beijing.maas.aliyuncs.com";
export const WAN_SHARED_HOST = "dashscope.aliyuncs.com";

export const WAN_DEFAULT_MODEL = "wan2.7-i2v-2026-04-25";

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i;

export function isValidWorkspaceId(value: string) {
  return WORKSPACE_ID_PATTERN.test(value.trim());
}

/**
 * 解析 Base URL 的优先级：用户显式填写的地址 > 业务空间专属域名 > 共享域名。
 * 业务空间 ID 来自表单或服务端环境变量。
 */
export function resolveWanBaseUrl(input: { baseUrl?: string; workspaceId?: string; region?: string }) {
  const explicit = input.baseUrl?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  const region = input.region?.trim() || "cn-beijing";
  const workspaceId = input.workspaceId?.trim();
  // 只有北京地域走业务空间专属域名；其它地域用共享域名，避免拼出错误主机。
  if (workspaceId && isValidWorkspaceId(workspaceId) && region === "cn-beijing") return `https://${workspaceId}.${WAN_BEIJING_SUFFIX}`;
  return `https://${WAN_SHARED_HOST}`;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

/**
 * 第一阶段只做「首帧图生视频」：一张商品图作为 first_frame。
 * 首帧决定商品身份，因此固定取参考图的第一张（与 Prompt 里 [图1] 的约定一致）。
 */
export function buildWanMedia(urls: string[]) {
  const first = urls[0];
  if (!first) throw new WanError("首帧图生视频需要 1 张参考图。", "WAN_MISSING_FIRST_FRAME", 400);
  return [{ type: "first_frame" as const, url: first }];
}

/**
 * Wan2.7 请求体。参数名与取值范围对应官方新协议：
 * 分辨率用 `720P` 大写写法，时长单位为秒，`prompt_extend` 开启提示词改写，
 * `watermark: false` 与官方默认一致，也满足商品广告不加水印的要求。
 *
 * 本轮只实现 5 秒 720P：既符合「先只做 5 秒」的范围，也把免费额度消耗压到最低。
 */
export function buildWanRequestBody(config: ProviderRuntimeConfig, input: VideoJobInput, prompt: string, urls: string[]) {
  void input;
  return {
    model: config.model || WAN_DEFAULT_MODEL,
    input: {
      prompt,
      media: buildWanMedia(urls),
    },
    parameters: {
      resolution: "720P" as const,
      duration: 5 as const,
      prompt_extend: true,
      watermark: false,
    },
  };
}

/**
 * 百炼状态机。与方舟不同，这里多出两个必须区别对待的状态：
 *   - CANCELED 是明确的终态失败；
 *   - UNKNOWN 表示任务不存在或状态不可知（查询窗口超过 24 小时后也会返回它），
 *     既不能当成完成，也不能当成失败，否则会把一个可能仍在计费的任务直接判死。
 *     unknown 原样上抛，由现有轮询链路按「不确定状态」继续处理。
 */
export function mapWanStatus(raw: string): WanStatus {
  const status = raw.trim().toUpperCase();
  if (status === "PENDING") return "queued";
  if (status === "RUNNING") return "generating";
  if (status === "SUCCEEDED") return "completed";
  if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") return "failed";
  return "unknown";
}

/** 创建接口的错误在顶层；查询接口的错误嵌在 output 里。这里两种都取。 */
function errorFields(payload: unknown) {
  const body = payload as { code?: string; message?: string; output?: { code?: string; message?: string } } | null;
  const code = (body?.code ?? body?.output?.code ?? "").toLowerCase();
  const message = (body?.message ?? body?.output?.message ?? "").toLowerCase();
  return { code, hints: `${code} ${message}` };
}

/**
 * 把百炼的错误翻译成用户可以看懂的中文说明。
 * 不向用户暴露 stack trace、原始 JSON、SQL、文件路径或 API Key。
 */
export function mapWanError(status: number, payload: unknown): WanError {
  const { code, hints } = errorFields(payload);

  // 业务空间 ID 填错是接入期最常见的问题，给一句能直接照做的说明。
  // 服务端口径实测为 `400 BadRequest.IllegalEndpoint / "Workspace endpoint is invalid."`。
  if (/illegalendpoint|illegal_endpoint|workspace.?endpoint/.test(hints)) {
    return new WanError("业务空间 ID 不正确，请在系统设置 → 视频模型 → 阿里云 Wan 中填写百炼控制台里的业务空间 ID。", "WAN_INVALID_WORKSPACE", 400);
  }
  if (status === 401 || status === 403) {
    if (/workspace|subaccount|sub_account|permission|forbidden|denied|权限/.test(hints)) {
      return new WanError("该 API Key 没有访问这个百炼业务空间的权限，请确认业务空间 ID 与密钥来自同一个账号。", "WAN_WORKSPACE_FORBIDDEN", 403);
    }
    return new WanError("API Key 无效，请在系统设置 → 视频模型中重新填写阿里云百炼密钥。", "WAN_UNAUTHORIZED", 401);
  }
  if (status === 429 || /throttl|quota|ratelimit|rate_limit|limit|balance|arrearage|欠费|额度/.test(hints)) {
    return new WanError("当前百炼额度不足或请求过于频繁，请稍后重试。", "WAN_QUOTA", 429);
  }
  if (status === 404) {
    return new WanError("Wan2.7 尚未开通，或视频任务已过期（查询窗口为 24 小时），请在百炼控制台确认。", "WAN_NOT_ENABLED", 404);
  }
  if (status === 400) {
    if (/model|not.?found|access|开通|no.?permission|unauthorized_model/.test(hints)) {
      return new WanError("Wan2.7 图生视频尚未开通，请在阿里云百炼控制台开通该模型。", "WAN_MODEL_UNAVAILABLE", 400);
    }
    if (/sensitive|moderation|content|policy|data.?inspection|审核|违规/.test(hints)) {
      return new WanError("内容审核未通过，请调整参考图或描述后重试。", "WAN_CONTENT_REJECTED", 400);
    }
    if (/url|download|http|image|media|format|size|resolution|duration|first_frame/.test(hints)) {
      return new WanError("参考图或视频参数不受支持，请确认图片是公网可访问的直链、且尺寸在官方范围内。", "WAN_INVALID_PARAMETER", 400);
    }
    return new WanError("视频生成失败，请重试。", "WAN_BAD_REQUEST", 400);
  }
  if (status >= 500) {
    return new WanError("阿里云百炼暂时不可用，请稍后重试。", "WAN_UNAVAILABLE", 502);
  }
  console.error("Wan request failed", { status, code: code || "unknown" });
  return new WanError("视频生成失败，请重试。", "WAN_REQUEST_FAILED", 502);
}

/** 任务本身失败时（查询接口已返回 FAILED / CANCELED），从 payload 推断原因并给出中文说明。 */
export function wanFailureMessage(providerStatus: string, payload: Record<string, unknown>) {
  if (providerStatus.toUpperCase() === "CANCELED" || providerStatus.toUpperCase() === "CANCELLED") {
    return "视频任务已被取消，请重新生成。";
  }
  const { hints } = errorFields(payload);
  if (/sensitive|moderation|content|policy|data.?inspection|审核|违规/.test(hints)) return "内容审核未通过，请调整参考图或描述后重试。";
  if (/url|download|image|media|格式/.test(hints)) return "参考图无法被百炼读取，请确认图片地址公网可访问后重试。";
  if (/balance|arrearage|quota|欠费|额度|余额/.test(hints)) return "当前百炼额度不足。";
  if (/model|access|开通/.test(hints)) return "Wan2.7 图生视频尚未开通。";
  return "视频生成失败，请重试。";
}

/**
 * 创建任务时**只**对限流做重试。视频任务很贵，创建请求超时或返回 5xx 时都无法确定
 * 百炼是否已经受理并计费，因此一律不重试，避免一次点击产生两条付费任务。
 */
export function shouldRetryWanCreate(error: unknown) {
  return error instanceof WanError && error.code === "WAN_QUOTA";
}

/** 查询任务没有副作用，因此 5xx 与限流都可以安全重试。 */
export function shouldRetryWanQuery(error: unknown) {
  return error instanceof WanError && (error.code === "WAN_UNAVAILABLE" || error.code === "WAN_QUOTA");
}
