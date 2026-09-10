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

export function safeShareFileName(value: string, index: number, mimeType: SupportedShareImageType) {
  const extension = extensions[mimeType];
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
  return `${stem || `xiaohongshu-image-${index + 1}`}${extension}`;
}
