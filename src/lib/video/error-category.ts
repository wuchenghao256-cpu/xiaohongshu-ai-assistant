// 相对路径 + 显式扩展名：项目测试脚本直接用 Node 运行，没有 @/ 别名解析。
import { SeedanceError } from "./seedance-mapping.ts";

/**
 * 创建任务的失败分类。这个分类直接决定「能不能重试」，是防重复扣费的核心：
 * 只有明确被上游拒绝（4xx）时，才能确定没有产生付费任务；
 * 超时 / 5xx / 网络中断时上游可能已经受理并计费，任何自动或隐式重发都会二次扣费。
 */
export type VideoCreateErrorCategory =
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "network"
  | "auth"
  | "rejected"
  | "invalid_response"
  | "unknown";

export type VideoPollErrorCategory = "timeout" | "unavailable" | "network" | "server";

const CREATE_TIMEOUT_CODES = new Set(["ARK_TIMEOUT"]);
const CREATE_UNAVAILABLE_CODES = new Set(["ARK_UNAVAILABLE"]);
const CREATE_NETWORK_CODES = new Set(["ARK_UNREACHABLE"]);
const CREATE_RATE_LIMIT_CODES = new Set(["ARK_QUOTA"]);
const CREATE_AUTH_CODES = new Set(["ARK_UNAUTHORIZED", "ARK_FORBIDDEN", "ARK_PORTRAIT_CONSENT"]);
const CREATE_REJECTED_CODES = new Set(["ARK_CONTENT_REJECTED", "ARK_INVALID_PARAMETER", "ARK_BAD_REQUEST", "ARK_NOT_ENABLED", "ARK_MODEL_UNAVAILABLE"]);
const CREATE_INVALID_RESPONSE_CODES = new Set(["ARK_INVALID_RESPONSE"]);

export function categorizeCreateError(error: unknown): VideoCreateErrorCategory {
  if (error instanceof SeedanceError) {
    if (CREATE_TIMEOUT_CODES.has(error.code)) return "timeout";
    if (CREATE_UNAVAILABLE_CODES.has(error.code)) return "unavailable";
    if (CREATE_NETWORK_CODES.has(error.code)) return "network";
    if (CREATE_RATE_LIMIT_CODES.has(error.code)) return "rate_limited";
    if (CREATE_AUTH_CODES.has(error.code)) return "auth";
    if (CREATE_REJECTED_CODES.has(error.code)) return "rejected";
    if (CREATE_INVALID_RESPONSE_CODES.has(error.code)) return "invalid_response";
    return error.status >= 500 ? "unavailable" : "unknown";
  }
  // fetch 在网络层抛错时是 TypeError，不是 SeedanceError。
  if (error instanceof TypeError) return "network";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "unknown";
}

/**
 * 上游是否可能已经受理并计费。true 时绝不能自动重发创建请求，
 * 也不能让用户用「重试」隐式重发——必须走恢复流程。
 */
export function mayHaveCreatedUpstream(category: VideoCreateErrorCategory) {
  return category === "timeout" || category === "unavailable" || category === "network" || category === "unknown" || category === "invalid_response";
}

const RECOVERABLE_SUFFIX = "任务可能已在生成服务中创建，请先点「恢复任务」确认，不要重复提交以免重复计费。";
const FAILED_SUFFIX = "本次未产生生成任务，额度未消耗，可直接重新生成。";

/** 在不覆盖 Provider 原始中文提示的前提下，补充用户接下来该怎么做。 */
export function withRecoveryHint(message: string, category: VideoCreateErrorCategory) {
  if (mayHaveCreatedUpstream(category)) return `${message}（${RECOVERABLE_SUFFIX}）`;
  return `${message}（${FAILED_SUFFIX}）`;
}

/** 创建请求超时时给用户看的提示：明确指向恢复入口而不是「重试」。 */
export const CREATE_TIMEOUT_USER_MESSAGE = `火山方舟响应超时。${RECOVERABLE_SUFFIX}`;

export const CREATE_UNKNOWN_USER_MESSAGE = `视频任务创建未完成。${RECOVERABLE_SUFFIX}`;

export function categorizePollError(error: unknown): VideoPollErrorCategory {
  if (error instanceof SeedanceError) {
    if (error.code === "ARK_TIMEOUT") return "timeout";
    if (error.code === "ARK_UNREACHABLE") return "network";
    if (error.status >= 500) return "unavailable";
    return "server";
  }
  if (error instanceof TypeError) return "network";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "server";
}
