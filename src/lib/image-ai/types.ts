import { z } from "zod";
import {
  modelGenders,
  modelGenerationModes,
  modelImageAspectRatios,
  modelImageTemplates,
  modelProductCategories,
  modelProductFocusOptions,
  modelStyles,
} from "@/lib/ai/image-template-config";

export const imageSceneOptions = [
  { value: "xiaohongshu", label: "小红书种草场景" },
  { value: "clean-product", label: "干净产品摄影" },
  { value: "daily-life", label: "日常生活场景" },
  { value: "desktop-still-life", label: "桌面静物" },
  { value: "custom", label: "自定义" },
] as const;

export const imageAspectRatios = ["1:1", "3:4", "4:5", "4:3", "9:16", "16:9"] as const;

export const legacyProductImageRequestSchema = z.object({
  taskId: z.string().uuid(),
  referenceAssetIds: z.array(z.string().uuid()).max(4).default([]),
  scene: z.enum(imageSceneOptions.map((option) => option.value)),
  sceneDescription: z.string().trim().min(5, "请具体描述希望生成的场景").max(600),
  imageStyle: z.string().trim().min(2, "请填写图片风格").max(160),
  aspectRatio: z.enum(imageAspectRatios),
  count: z.number().int().min(1).max(4),
});

export const modelProductImageRequestSchema = z.object({
  mode: z.literal("model-template"),
  taskId: z.string().uuid(),
  referenceAssetIds: z.array(z.string().uuid()).min(1, "请至少选择一张商品参考图").max(4),
  templateId: z.enum(modelImageTemplates.map((template) => template.id) as [string, ...string[]]),
  productCategory: z.enum(modelProductCategories),
  gender: z.enum(modelGenders),
  style: z.enum(modelStyles),
  aspectRatio: z.enum(modelImageAspectRatios),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  productFocus: z.enum(modelProductFocusOptions),
  generationMode: z.enum(modelGenerationModes).default("fidelity"),
});

export const productImageRequestSchema = z.union([
  modelProductImageRequestSchema,
  legacyProductImageRequestSchema,
]);

export type ImageScene = (typeof imageSceneOptions)[number]["value"];
export type ImageAspectRatio = (typeof imageAspectRatios)[number];
export type ProductImageRequest = z.infer<typeof productImageRequestSchema>;

export type ImageReference = {
  url: string;
  mimeType: string;
  primary?: boolean;
  width?: number;
  height?: number;
};
export type ImageGenerationInput = {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  references: ImageReference[];
};

export type GeneratedImage = {
  url?: string;
  b64Json?: string;
};
