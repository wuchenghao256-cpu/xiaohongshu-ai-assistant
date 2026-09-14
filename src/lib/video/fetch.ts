import "server-only";

/**
 * 带超时的 fetch。AbortController 由 setTimeout 触发，返回 Response 前必须清掉计时器。
 * 单独成文件是因为 Runway / Seedance / 视频转存三条路径都要用，且都不能无止境地挂着。
 */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 Storage 里的私有素材交给第三方 Provider（如阿里云百炼）时，需要一个公网可访问
 * 的直链。bucket 是私有的，签名地址才是唯一的可读入口；这里验一次可达性，避免把
 * 注定取不到的地址当成首帧图提交出去 —— 那样只会在几十秒后拿到一个模糊的失败。
 */
export async function verifyPublicImageUrl(url: string, timeoutMs = 15_000) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const response = await fetchWithTimeout(url, { method: "HEAD", cache: "no-store" }, timeoutMs);
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    return type === "" || type.startsWith("image/");
  } catch {
    return false;
  }
}
