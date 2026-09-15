"use client";

/**
 * 触发一次下载。
 *
 * 两处细节决定了它在手机上到底能不能用：
 *
 * 1. **必须传 blob objectURL，不能直接把同源 API 地址交给 `<a download>`。**
 *    `/api/video-jobs/[id]/download` 需要 Cookie 鉴权，而 `<a download>` 触发的
 *    导航在 iOS Safari 上并不保证带上凭据 —— 我们把字节先取进内存，就绕开了这个不确定性。
 *
 * 2. **objectURL 不能在函数返回时就 revoke。** 部分浏览器是异步读取它的，
 *    提前释放会让下载以 0 字节结束。这里给足 60 秒再回收。
 *
 * 离开页面后 objectURL 会被浏览器自动回收，因此不必担心泄漏。
 */
export function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * 从下载响应里取出文件名。服务端同时给了 `filename=`（ASCII 回退）与
 * `filename*=UTF-8''...`（真正生效的中文名），这里优先解析后者。
 */
export function fileNameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // 编码损坏时退回 ASCII 名，绝不让一次下载因为文件名的解析失败而中断。
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}
