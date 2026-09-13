import "server-only";
import type { ProviderRuntimeConfig } from "@/lib/providers/types";

function safeBaseUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host === "0.0.0.0" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith(".local")) throw new Error("API Base URL 必须是公开 HTTPS 地址");
  return url.toString().replace(/\/+$/, "");
}

export async function testProviderConnection(config: ProviderRuntimeConfig) {
  const base = safeBaseUrl(config.baseUrl);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const url = config.provider === "google" ? `${base}/models/${encodeURIComponent(config.model)}` : config.provider === "runway" ? `${base}/tasks/00000000-0000-0000-0000-000000000000` : `${base.replace(/\/images\/generations$/, "")}/models`;
    const headers: Record<string, string> = config.provider === "google" ? { "x-goog-api-key": config.apiKey } : { Authorization: `Bearer ${config.apiKey}` };
    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (response.status === 401 || response.status === 403) return { success: false, message: "Invalid API Key" };
    if (config.provider === "runway" && response.status === 404) return { success: true, message: "连接成功" };
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
