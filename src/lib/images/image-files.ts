export const supportedImageMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export type SupportedImageMimeType = (typeof supportedImageMimeTypes)[number];

export const imageExtensionByMime: Record<SupportedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return supportedImageMimeTypes.includes(value as SupportedImageMimeType);
}

export function sanitizeImageFilename(filename: string, mimeType: SupportedImageMimeType) {
  const extension = imageExtensionByMime[mimeType];
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  const safeBase = withoutExtension
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, 120);
  return `${safeBase || "product-image"}.${extension}`;
}

export async function readBrowserImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("INVALID_IMAGE_DIMENSIONS");
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
