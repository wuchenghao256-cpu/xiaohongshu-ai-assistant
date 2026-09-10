import { AiProviderError } from "@/lib/ai/provider";
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
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return Response.json({ error: "登录状态已失效，请重新登录。", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED") {
    return Response.json({ error: "Supabase 尚未配置。", code: "CONFIG_MISSING" }, { status: 503 });
  }
  console.error("Unhandled route error", { error: error instanceof Error ? error.message : "unknown" });
  return Response.json({ error: "服务暂时不可用，请稍后重试。", code: "INTERNAL_ERROR" }, { status: 500 });
}
