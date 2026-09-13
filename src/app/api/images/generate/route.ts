import { jsonError } from "@/lib/http";
import { buildModelImagePrompt } from "@/lib/ai/build-model-image-prompt";
import { getModelImageTemplate } from "@/lib/ai/image-template-config";
import { generateModelProductImages, generateProductImages } from "@/lib/image-ai/client";
import { buildProductImagePrompt } from "@/lib/image-ai/image-prompts";
import { prepareProductReferences, type ReferenceAssetRecord } from "@/lib/image-ai/prepare-references";
import { ImageGenerationError } from "@/lib/image-ai/provider";
import { productImageRequestSchema, type GeneratedImage } from "@/lib/image-ai/types";
import { sanitizeImageFilename } from "@/lib/images/image-files";
import { requireUser } from "@/lib/supabase/auth";

export const maxDuration = 300;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const supportedMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const extensionByMime: Record<(typeof supportedMimeTypes)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type PersistableImage = {
  bytes: Uint8Array;
  mimeType: (typeof supportedMimeTypes)[number];
};

function parseMimeType(value: string | null) {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return supportedMimeTypes.find((supported) => supported === mimeType);
}

async function materializeImage(image: GeneratedImage): Promise<PersistableImage> {
  if (image.b64Json) {
    const dataUri = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/i.exec(image.b64Json);
    const mimeType = parseMimeType(dataUri?.[1] ?? "image/jpeg");
    const bytes = Uint8Array.from(Buffer.from(dataUri?.[2] ?? image.b64Json, "base64"));
    if (!mimeType || bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageGenerationError("生成图片格式无效或文件超过 8MB。", "DOWNLOAD_FAILED", 502);
    }
    return { bytes, mimeType };
  }

  if (!image.url) {
    throw new ImageGenerationError("图片生成服务没有返回可保存的图片。", "INVALID_RESPONSE", 502);
  }
  const url = new URL(image.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImageGenerationError("图片生成服务返回了无效下载地址。", "DOWNLOAD_FAILED", 502);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      throw new ImageGenerationError("生成图片下载失败，请稍后重试。", "DOWNLOAD_FAILED", 502);
    }
    const mimeType = parseMimeType(response.headers.get("content-type"));
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!mimeType || contentLength > MAX_IMAGE_BYTES) {
      throw new ImageGenerationError("生成图片格式不支持或文件超过 8MB。", "DOWNLOAD_FAILED", 502);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageGenerationError("生成图片为空或文件超过 8MB。", "DOWNLOAD_FAILED", 502);
    }
    return { bytes, mimeType };
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImageGenerationError("生成图片下载超时，请稍后重试。", "DOWNLOAD_FAILED", 504);
    }
    throw new ImageGenerationError("生成图片下载失败，请稍后重试。", "DOWNLOAD_FAILED", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];
  const insertedAssetIds: string[] = [];
  try {
    const input = productImageRequestSchema.parse(await request.json());
    const { user, supabase } = await requireUser();

    const taskResult = await supabase
      .from("content_tasks")
      .select("id, product_name")
      .eq("id", input.taskId)
      .single();
    if (taskResult.error || !taskResult.data) throw taskResult.error ?? new Error("TASK_NOT_FOUND");

    const assetCount = await supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("task_id", input.taskId);
    if (assetCount.error) throw assetCount.error;
    if ((assetCount.count ?? 0) + input.count > 9) {
      return Response.json({ error: "当前任务最多保存 9 张图片。" }, { status: 400 });
    }

    const referenceResult = input.referenceAssetIds.length
      ? await supabase
          .from("assets")
          .select("id, storage_bucket, storage_path, mime_type, size_bytes, width, height")
          .eq("task_id", input.taskId)
          .in("id", input.referenceAssetIds)
      : { data: [], error: null };
    if (referenceResult.error) throw referenceResult.error;
    if ((referenceResult.data?.length ?? 0) !== input.referenceAssetIds.length) {
      return Response.json({ error: "部分参考图片不存在或无权访问。" }, { status: 403 });
    }

    const references = await prepareProductReferences({
      requestedIds: input.referenceAssetIds,
      assets: (referenceResult.data ?? []) as ReferenceAssetRecord[],
      createSignedUrl: async (asset) => {
        const signed = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 600);
        if (signed.error) {
          throw new ImageGenerationError("参考图片读取失败，请重新上传。", "STORAGE_FAILED", 502);
        }
        return signed.data.signedUrl;
      },
    });

    let generated: GeneratedImage[];
    let assetNamePrefix = "AI生成商品图";
    if ("mode" in input) {
      const template = getModelImageTemplate(input.templateId);
      if (!template) return Response.json({ error: "所选模特商品图模板不存在。" }, { status: 400 });
      const prompt = buildModelImagePrompt({
        template,
        productName: taskResult.data.product_name,
        productCategory: input.productCategory,
        gender: input.gender,
        style: input.style,
        productFocus: input.productFocus,
        generationMode: input.generationMode,
        creativeVariation: input.creativeVariation,
        referenceCount: references.length,
      });
      generated = await generateModelProductImages(user.id, {
        prompt: prompt.positivePrompt,
        negativePrompt: prompt.negativePrompt,
        aspectRatio: input.aspectRatio,
        count: input.count,
        references,
      });
      assetNamePrefix = `AI模特商品图-${template.name}`;
    } else {
      const prompt = buildProductImagePrompt({
        productName: taskResult.data.product_name,
        scene: input.scene,
        sceneDescription: input.sceneDescription,
        imageStyle: input.imageStyle,
        hasReference: references.length > 0,
      });
      generated = await generateProductImages(user.id, {
        prompt,
        aspectRatio: input.aspectRatio,
        count: input.count,
        references,
      });
    }
    if (generated.length !== input.count) {
      throw new ImageGenerationError("图片生成数量与请求不一致，请重试。", "INVALID_RESPONSE", 502);
    }

    const assets = [];
    for (const [index, generatedImage] of generated.entries()) {
      const image = await materializeImage(generatedImage);
      const extension = extensionByMime[image.mimeType];
      const storagePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("product-assets").upload(storagePath, image.bytes, {
        contentType: image.mimeType,
        upsert: false,
      });
      if (upload.error) {
        throw new ImageGenerationError("生成图片保存到 Storage 失败，请稍后重试。", "STORAGE_FAILED", 502);
      }
      uploadedPaths.push(storagePath);

      const asset = await supabase.from("assets").insert({
        user_id: user.id,
        task_id: input.taskId,
        storage_path: storagePath,
        original_name: sanitizeImageFilename(`${assetNamePrefix}-${index + 1}.${extension}`, image.mimeType),
        mime_type: image.mimeType,
        size_bytes: image.bytes.byteLength,
        selected_for_publishing: true,
      }).select("id, storage_path, original_name, mime_type, size_bytes").single();
      if (asset.error) {
        throw new ImageGenerationError("生成图片记录保存失败，请稍后重试。", "STORAGE_FAILED", 502);
      }
      insertedAssetIds.push(asset.data.id);
      const signed = await supabase.storage.from("product-assets").createSignedUrl(storagePath, 3600);
      if (signed.error) {
        throw new ImageGenerationError("生成图片读取链接创建失败。", "STORAGE_FAILED", 502);
      }
      assets.push({ ...asset.data, signedUrl: signed.data.signedUrl });
    }

    const existingPost = await supabase.from("posts").select("id").eq("task_id", input.taskId).maybeSingle();
    if (existingPost.error) throw existingPost.error;
    if (!existingPost.data) {
      const post = await supabase.from("posts").insert({
        user_id: user.id,
        task_id: input.taskId,
        title: taskResult.data.product_name || "商品图片草稿",
        body: "",
        hashtags: [],
        status: "draft",
        publish_status: "draft",
      });
      if (post.error) throw post.error;
    }

    return Response.json({ assets, referenceImageCount: references.length });
  } catch (error) {
    if (uploadedPaths.length || insertedAssetIds.length) {
      try {
        const { supabase } = await requireUser();
        if (insertedAssetIds.length) await supabase.from("assets").delete().in("id", insertedAssetIds);
        if (uploadedPaths.length) await supabase.storage.from("product-assets").remove(uploadedPaths);
      } catch {
        console.error("Generated image cleanup failed");
      }
    }
    return jsonError(error);
  }
}
