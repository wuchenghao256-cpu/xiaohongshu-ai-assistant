import { ImageGenerationError, type ImageGenerationFailureCode } from "@/lib/image-ai/provider";

/**
 * 图片生成失败原因分类。用户需要能区分「限流」「服务故障」「超时」「保存失败」
 * 等不同情况，因为对应的处理动作完全不同（等待 / 重试 / 换图 / 联系支持）。
 *
 * DB_FAILED 与 POLLING_FAILED 由接口层的数据库/轮询包装抛出，不在 Provider 错误码里。
 */
export const imageFailureCategories = [
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "TIMEOUT",
  "STORAGE_FAILED",
  "DB_FAILED",
  "POLLING_FAILED",
  "CONTENT_REJECTED",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "CONFIG_MISSING",
  "UNKNOWN",
] as const;

export type ImageFailureCategory = (typeof imageFailureCategories)[number];

export type ImageFailure = {
  category: ImageFailureCategory;
  /** Retrying the same request could plausibly succeed. */
  retriable: boolean;
  /** 直接展示给用户的中文说明。 */
  message: string;
  /** 下一步该做什么，前端用一行小字提示。 */
  hint: string;
};

const failures: Record<ImageFailureCategory, Omit<ImageFailure, "category">> = {
  RATE_LIMITED: {
    retriable: true,
    message: "图片生成服务当前请求过于频繁（429 限流）。",
    hint: "系统已自动退避重试。仍失败说明并发过高，请减少生成数量后稍等片刻。",
  },
  PROVIDER_ERROR: {
    retriable: true,
    message: "图片生成服务暂时不可用（服务端错误）。",
    hint: "属于第三方服务波动，稍后重试通常即可恢复。",
  },
  TIMEOUT: {
    retriable: true,
    message: "图片生成超时，第三方服务在规定时间内没有返回结果。",
    hint: "任务可能仍在第三方侧执行，稍后重试即可。",
  },
  STORAGE_FAILED: {
    retriable: true,
    message: "图片已生成，但保存到存储空间失败。",
    hint: "检查 Supabase Storage 配额与 product-assets 存储桶策略后重试。",
  },
  DB_FAILED: {
    retriable: true,
    message: "图片批次记录写入数据库失败。",
    hint: "确认数据库迁移已全部执行，然后重试。",
  },
  POLLING_FAILED: {
    retriable: true,
    message: "查询图片生成进度失败。",
    hint: "轮询连接中断，刷新页面即可继续获取结果。",
  },
  CONTENT_REJECTED: {
    retriable: false,
    message: "图片生成服务以内容安全策略拒绝了本次请求。",
    hint: "请更换参考图或调整场景描述，去掉敏感元素后再试。",
  },
  VALIDATION_ERROR: {
    retriable: false,
    message: "提交的生成参数不合法。",
    hint: "请检查参考图数量、生成张数和模板选择。",
  },
  UNAUTHORIZED: {
    retriable: false,
    message: "登录状态已失效。",
    hint: "请重新登录后再生成。",
  },
  CONFIG_MISSING: {
    retriable: false,
    message: "图片生成服务尚未配置。",
    hint: "请到「系统设置 → AI Provider」启用并保存一个图片 Provider。",
  },
  UNKNOWN: {
    retriable: false,
    message: "图片生成失败。",
    hint: "请稍后重试；若持续失败请联系支持并提供失败时间。",
  },
};

export function describeFailure(category: ImageFailureCategory): ImageFailure {
  return { category, ...failures[category] };
}

/** Provider 层错误码到用户可见分类的映射。 */
const byProviderCode: Record<ImageGenerationFailureCode, ImageFailureCategory> = {
  RATE_LIMITED: "RATE_LIMITED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  TIMEOUT: "TIMEOUT",
  CONTENT_REJECTED: "CONTENT_REJECTED",
  STORAGE_FAILED: "STORAGE_FAILED",
  CONFIG_MISSING: "CONFIG_MISSING",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  DOWNLOAD_FAILED: "STORAGE_FAILED",
  INVALID_RESPONSE: "PROVIDER_ERROR",
  REQUEST_FAILED: "PROVIDER_ERROR",
};

/** HTTP 状态码兜底：Supabase / 网关等非 Provider 错误也会走到这里。 */
function fromStatus(status: number): ImageFailureCategory | null {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "PROVIDER_ERROR";
  if (status >= 400) return "VALIDATION_ERROR";
  return null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function statusOf(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

/**
 * 把任意错误归类成用户可读的失败原因。顺序很重要：先看显式错误码，
 * 再看 HTTP 状态，最后才回退到关键字匹配。
 */
export function classifyImageFailure(error: unknown): ImageFailure {
  if (error instanceof ImageGenerationError) return describeFailure(byProviderCode[error.code] ?? "UNKNOWN");

  const status = statusOf(error);
  if (status !== undefined) {
    const category = fromStatus(status);
    if (category) return describeFailure(category);
  }

  const message = messageOf(error);
  if (message === "UNAUTHORIZED") return describeFailure("UNAUTHORIZED");
  if (message === "SUPABASE_NOT_CONFIGURED") return describeFailure("CONFIG_MISSING");
  if (/timeout|timed out|aborted|超时/i.test(message)) return describeFailure("TIMEOUT");
  if (/\b429\b|rate limit|too many requests|限流/i.test(message)) return describeFailure("RATE_LIMITED");
  if (/storage|bucket|storage_path|payload too large|存储/i.test(message)) return describeFailure("STORAGE_FAILED");
  if (/moderation|safety|rejected|sensitive|审核|违规|敏感/i.test(message)) return describeFailure("CONTENT_REJECTED");
  if (/duplicate key|violates|does not exist|null value in column|database|数据库/i.test(message)) return describeFailure("DB_FAILED");
  if (/fetch failed|network|ECONNRESET|ENOTFOUND|无法连接/i.test(message)) return describeFailure("PROVIDER_ERROR");
  return describeFailure("UNKNOWN");
}

export function isRetriableFailure(error: unknown) {
  return classifyImageFailure(error).retriable;
}

/**
 * 结构化失败日志。刻意不打印参考图 URL、签名链接或 API Key，
 * 只保留定位问题需要的元数据。
 */
export function logImageFailure(stage: string, error: unknown, context: Record<string, unknown> = {}) {
  const failure = classifyImageFailure(error);
  console.error("Image generation failed", {
    stage,
    category: failure.category,
    retriable: failure.retriable,
    status: statusOf(error),
    message: messageOf(error).slice(0, 500) || undefined,
    ...context,
  });
  return failure;
}
