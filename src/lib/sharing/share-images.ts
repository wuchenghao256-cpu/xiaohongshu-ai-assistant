export const supportedShareImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export type SupportedShareImageType = (typeof supportedShareImageTypes)[number];

const extensions: Record<SupportedShareImageType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function isSupportedShareImageType(value: string): value is SupportedShareImageType {
  return supportedShareImageTypes.includes(value.toLowerCase() as SupportedShareImageType);
}

/**
 * 把用户可见的名字清洗成安全的文件名主体（不含扩展名）。
 *
 * 路径分隔符、控制字符与双向文本控制符一律换成下划线，Windows 保留设备名加前缀规避，
 * 最后裁剪长度。图片分享与视频下载共用这一份实现 —— 这类清洗很容易在两处慢慢漂移。
 */
export function safeFileNameStem(value: string) {
  const source = value.normalize("NFKC").split(/[\\/]/).pop() ?? "";
  const withoutExtension = source.replace(/\.[^.]*$/, "");
  const cleanedStem = withoutExtension
    .replace(/[<>:"|?*\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  const stem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleanedStem)
    ? `_${cleanedStem}`
    : cleanedStem;
  return stem;
}

export function safeShareFileName(value: string, index: number, mimeType: SupportedShareImageType) {
  return `${safeFileNameStem(value) || `xiaohongshu-image-${index + 1}`}${extensions[mimeType]}`;
}
