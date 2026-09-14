import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.string().url(),
  AI_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1),
  PROVIDER_CONFIG_ENCRYPTION_KEY: z.string().min(43).optional(),
});

const imageAiEnvSchema = z.object({
  IMAGE_AI_BASE_URL: z.string().url(),
  IMAGE_AI_API_KEY: z.string().min(1),
  IMAGE_AI_MODEL: z.string().min(1).refine(
    (value) => /^(?:ep-|doubao-seedream-|seedream-)/i.test(value),
    "必须填写 Seedream 模型 ID 或方舟 Endpoint ID",
  ),
});

/**
 * 阿里云百炼（Model Studio / DashScope）凭据。
 *
 * 与其它 Provider 不同，这把 Key 走环境变量而不是设置页：百炼按业务空间的主账号绑定的
 * 子账号校验密钥，应用用户自己粘贴的 Key 在提交时会因空间权限失败，而且这条路只服务
 * 一个工作区。模块带 `server-only`，因此这里读到的值不可能进入浏览器 bundle。
 *
 * 只有 API Key 是必需的。业务空间 ID 与地域故意放宽为普通字符串：它们是 Endpoint 的
 * 输入而不是不变量，格式校验交给真正拼接主机名的那一层（resolveWanBaseUrl），
 * 这样一个格式不对的业务空间 ID 不会连带把 API Key 也判成「未配置」。
 */
const dashscopeEnvSchema = z.object({
  DASHSCOPE_API_KEY: z.string().min(1),
  DASHSCOPE_WORKSPACE_ID: z.string().trim().min(1).optional(),
  DASHSCOPE_REGION: z.string().trim().min(1).optional(),
});

export type DashscopeEnv = z.infer<typeof dashscopeEnvSchema>;

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join("、");
    throw new Error(`服务器配置不完整：${fields}`);
  }
  return parsed.data;
}

export function getProviderEncryptionKey() {
  const value = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  if (!value) throw new Error("PROVIDER_CONFIG_ENCRYPTION_KEY_NOT_CONFIGURED");
  return value;
}

export function hasProviderEncryptionKey() {
  return Boolean(process.env.PROVIDER_CONFIG_ENCRYPTION_KEY);
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

/**
 * 读取百炼凭据。未配置时返回 null 而不是抛错：业务空间 ID 由用户稍后在设置页填写，
 * 这里只负责提供环境变量里那部分，并让上层决定是「用环境变量」还是「用设置页」。
 */
export function getDashscopeEnv(): DashscopeEnv | null {
  const parsed = dashscopeEnvSchema.safeParse(process.env);
  return parsed.success ? parsed.data : null;
}

export function hasDashscopeApiKey() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}
