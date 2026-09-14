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
