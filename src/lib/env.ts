import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url(),
  AI_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1),
});

const imageAiEnvSchema = z.object({
  IMAGE_AI_BASE_URL: z.string().url(),
  IMAGE_AI_API_KEY: z.string().min(1),
  IMAGE_AI_MODEL: z.string().min(1).refine(
    (value) => /^(?:ep-|doubao-seedream-|seedream-)/i.test(value),
    "必须填写 Seedream 模型 ID 或方舟 Endpoint ID",
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join("、");
    throw new Error(`服务器配置不完整：${fields}`);
  }
  return parsed.data;
}

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function getAiConfigStatus() {
  return {
    configured: Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL),
    model: process.env.AI_MODEL ?? "未配置",
    baseUrl: process.env.AI_BASE_URL ? new URL(process.env.AI_BASE_URL).origin : "未配置",
  };
}

export function getImageAiEnv() {
  const parsed = imageAiEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join("、");
    throw new Error(`图片 AI 配置不完整：${fields}`);
  }
  return parsed.data;
}

export function getImageAiConfigStatus() {
  const parsed = imageAiEnvSchema.safeParse(process.env);
  return {
    configured: parsed.success,
    model: parsed.success ? parsed.data.IMAGE_AI_MODEL : "未配置",
  };
}
