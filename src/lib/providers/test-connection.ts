import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

function safeBaseUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host === "0.0.0.0" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local")) throw new Error("API Base URL 必须是公开 HTTPS 地址");
  return url.toString().replace(/\/+$/, "");
}

/** 阿里云百炼的华北2（北京）Endpoint 是业务空间专属域名，没有配置时退回共享域名。 */
function dashscopeBaseUrl(config: ProviderRuntimeConfig) {
  const explicit = config.baseUrl.trim();
  if (explicit) return safeBaseUrl(explicit);
  const workspaceId = config.workspaceId?.trim();
  const region = config.region?.trim() || "cn-beijing";
  if (workspaceId && region === "cn-beijing") return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
  return "https://dashscope.aliyuncs.com";
}

export async function testProviderConnection(config: ProviderRuntimeConfig) {
  const base = config.provider === "alibaba" ? dashscopeBaseUrl(config) : safeBaseUrl(config.baseUrl);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    // 火山方舟与阿里云百炼都没有公开的模型列表接口，用一次不存在的任务查询来验证 API Key：
    // 401 => Key 无效；404 => Key 有效但该任务不存在。
    const url = config.provider === "google" ? `${base}/models/${encodeURIComponent(config.model)}` : config.provider === "runway" ? `${base}/tasks/00000000-0000-0000-0000-000000000000` : config.provider === "volcengine" ? `${base}/contents/generations/tasks/00000000-0000-0000-0000-000000000000` : config.provider === "alibaba" ? `${base}/api/v1/tasks/00000000-0000-0000-0000-000000000000` : `${base.replace(/\/images\/generations$/, "")}/models`;
    const headers: Record<string, string> = config.provider === "google" ? { "x-goog-api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` };
    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: config.provider === "alibaba" ? "API Key 无效，或该密钥没有访问此业务空间的权限" : "Invalid API Key" };
    }
    // 业务空间 ID 填错时百炼返回 400 BadRequest.IllegalEndpoint，这是「地址错」而不是「密钥错」，
    // 必须单独提示，否则用户会去反复检查密钥。
    if (config.provider === "alibaba" && response.status === 400) {
      const payload = await response.json().catch(() => null) as { code?: string } | null;
      if (/illegalendpoint/i.test(payload?.code ?? "")) return { success: false, message: "业务空间 ID 不正确；请填写百炼控制台里的业务空间 ID" };
      // 其它 400（例如任务 ID 不存在）反而说明密钥有效。
      return { success: true, message: "连接成功；请确认已开通 Wan2.7 图生视频" };
    }
    if (config.provider === "runway" && response.status === 404) return { success: true, message: "连接成功" };
    if (config.provider === "volcengine" && response.status === 404) return { success: true, message: "连接成功；请确认已开通 Seedance 2.0" };
    if (config.provider === "alibaba" && response.status === 404) return { success: true, message: "连接成功；请确认已开通 Wan2.7 图生视频" };
    if (response.status === 404) return { success: false, message: "Model not found or models endpoint unavailable" };
    if (!response.ok) return { success: false, message: `API unavailable (HTTP ${response.status})` };
    if (config.provider !== "google") {
      const payload = await response.json().catch(() => null) as { data?: Array<{ id?: string }> } | null;
      if (payload?.data?.length && !payload.data.some((item) => item.id === config.model)) return { success: false, message: "Model not found" };
    }
    return { success: true, message: "连接成功" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { success: false, message: "Provider timeout" };
    return { success: false, message: error instanceof Error && error.message.includes("HTTPS") ? error.message : "API unavailable" };
  } finally { clearTimeout(timer); }
}
