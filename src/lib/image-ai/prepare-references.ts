import "server-only";
import { ImageGenerationError } from "@/lib/image-ai/provider";
import type { ImageReference } from "@/lib/image-ai/types";
import { isSupportedImageMimeType } from "@/lib/images/image-files";

const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

export type ReferenceAssetRecord = {
  id: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
};

export async function prepareProductReferences(input: {
  requestedIds: string[];
  assets: ReferenceAssetRecord[];
  createSignedUrl: (asset: ReferenceAssetRecord) => Promise<string>;
}): Promise<ImageReference[]> {
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));
  const orderedAssets = input.requestedIds.map((id) => byId.get(id));
  if (orderedAssets.some((asset) => !asset)) {
    throw new ImageGenerationError("部分参考图片不存在或无权访问。", "STORAGE_FAILED", 403);
  }

  return Promise.all(orderedAssets.map(async (asset, index) => {
    if (!asset || !isSupportedImageMimeType(asset.mime_type)) {
      throw new ImageGenerationError("参考图片仅支持 JPEG、PNG 或 WebP。", "STORAGE_FAILED", 400);
    }
    if (asset.size_bytes <= 0 || asset.size_bytes > MAX_REFERENCE_BYTES) {
      throw new ImageGenerationError("参考图片为空或超过 8MB。", "STORAGE_FAILED", 400);
    }
    if ((asset.width !== null && asset.width <= 0) || (asset.height !== null && asset.height <= 0)) {
      throw new ImageGenerationError("参考图片尺寸信息无效，请重新上传。", "STORAGE_FAILED", 400);
    }
    return {
      url: await input.createSignedUrl(asset),
      mimeType: asset.mime_type,
      primary: index === 0,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
    };
  }));
}
