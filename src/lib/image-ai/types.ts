import { z } from "zod";

export const imageSceneOptions = [
  { value: "xiaohongshu", label: "小红书种草场景" },
  { value: "clean-product", label: "干净产品摄影" },
  { value: "daily-life", label: "日常生活场景" },
  { value: "desktop-still-life", label: "桌面静物" },
  { value: "custom", label: "自定义" },
] as const;

export const imageAspectRatios = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

export const productImageRequestSchema = z.object({
  taskId: z.string().uuid(),
  referenceAssetIds: z.array(z.string().uuid()).max(4).default([]),
  scene: z.enum(imageSceneOptions.map((option) => option.value)),
  sceneDescription: z.string().trim().min(5, "请具体描述希望生成的场景").max(600),
  imageStyle: z.string().trim().min(2, "请填写图片风格").max(160),
  aspectRatio: z.enum(imageAspectRatios),
  count: z.number().int().min(1).max(4),
});

export type ImageScene = (typeof imageSceneOptions)[number]["value"];
export type ImageAspectRatio = (typeof imageAspectRatios)[number];
export type ProductImageRequest = z.infer<typeof productImageRequestSchema>;

export type ImageReference = { url: string; mimeType: string };
export type ImageGenerationInput = {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  references: ImageReference[];
};

export type GeneratedImage = {
  url?: string;
  b64Json?: string;
};
