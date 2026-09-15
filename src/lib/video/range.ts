/**
 * 视频下载代理的单段 Range 解析。
 *
 * 与 playback.ts 同一套路 —— 刻意不 import 任何运行期依赖，可以直接用 `node --test`
 * 覆盖「iOS 的 0-1 探测 / 后缀写法 / 越界 / 多段 / 畸形输入」这些分支。
 *
 * 为什么这件事必须做对：iOS 上**所有**浏览器的 <video> 在播放前都会先发
 * `Range: bytes=0-1`，只有拿到 206 + Content-Range 才肯播放；一个忽略 Range、
 * 无论请求什么都回 200 整文件的接口，在 iPhone 上表现为「转圈 / 划掉的播放键」。
 * 这条接口同时是发布助手里的视频预览源，因此不是可选优化。
 */

export type ByteRange = { start: number; end: number };

/**
 * 解析单段字节区间。返回 null 表示「不要按区间响应」——调用方据此决定回整文件
 * 还是回 416。多段 Range（`bytes=0-1,5-6`）按规范允许退化成整文件，这里也返回 null。
 *
 * `size` 为 0（上游没给长度）时一律回 null，避免算出一个非法的区间。
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  // `bytes=-` 两个数字都没有，是畸形写法。
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // 后缀写法 `bytes=-N`：取最后 N 个字节。
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (start >= size) return null; // 起点越界 → 调用方回 416
    end = Math.min(end, size - 1);
  }
  if (start > end) return null;
  return { start, end };
}

/**
 * `Range` 头是否是「格式正确但可能不可满足」的单段写法。
 *
 * 用来区分两种 null：`bytes=999999-` 起点越界必须回 416，而 `bytes=abc` 这种
 * 畸形输入按规范应当被忽略、回整文件。
 */
export function isWellFormedRange(header: string | null): boolean {
  return Boolean(header) && /^bytes=\d*-\d*$/.test((header as string).trim());
}
