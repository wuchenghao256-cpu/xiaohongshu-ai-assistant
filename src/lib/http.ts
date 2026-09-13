import { AiProviderError } from "@/lib/ai/provider";
import { logImageFailure } from "@/lib/image-ai/failure";
import { ImageGenerationError } from "@/lib/image-ai/provider";
import { ZodError } from "zod";

export function jsonError(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "提交内容格式不正确。", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  if (error instanceof AiProviderError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ImageGenerationError) {
    return Response.json({ error: error.message, code: error.code, category: error.code, retriable: isRetriableCode(error.code) }, { status: error.status });
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return Response.json({ error: "登录状态已失效，请重新登录。", code: "UNAUTHORIZED", category: "UNAUTHORIZED", retriable: false }, { status: 401 });
  }
  if (error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED") {
    return Response.json({ error: "Supabase 尚未配置。", code: "CONFIG_MISSING", category: "CONFIG_MISSING", retriable: false }, { status: 503 });
  }
  // 兜底分支拿到的是 Supabase 等非 Provider 错误：分类后再决定文案，避免把原始
  // 数据库错误直接暴露给用户，同时保证服务端日志能区分是保存失败还是查询失败。
  const failure = logImageFailure("route", error);
  return Response.json({ error: failure.message, code: failure.category, category: failure.category, retriable: failure.retriable }, { status: 500 });
}

function isRetriableCode(code: ImageGenerationError["code"]) {
  return code === "RATE_LIMITED" || code === "PROVIDER_ERROR" || code === "TIMEOUT" || code === "STORAGE_FAILED";
}
