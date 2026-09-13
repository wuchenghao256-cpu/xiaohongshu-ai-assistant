import { z } from "zod";

export const videoDurations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export const productCategories = ["fashion", "beauty", "jewelry", "electronics", "food", "home", "general"] as const;
export type ProductCategory = (typeof productCategories)[number];

export const productCategoryLabels: Record<ProductCategory, string> = {
  fashion: "服饰",
  beauty: "美妆个护",
  jewelry: "珠宝配饰",
  electronics: "3C 电子",
  food: "食品饮料",
  home: "家居百货",
  general: "通用商品",
};

// 火山方舟 Seedance 2.0 限制：多模态参考最多 9 张图片（2.0 fast 同样为 9 张）。
export const MAX_REFERENCE_IMAGES = 9;
// 用户点击生成时前端生成，用于防止重复提交造成重复计费。
const idempotencyKey = z.string().uuid().optional();
const duration = z.number().int().min(4).max(15);
const orientation = z.enum(["landscape", "portrait"]);
const referenceImagePaths = z.array(z.string().min(1).max(500));

export const videoJobInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image_to_video"),
    inputPaths: referenceImagePaths.length(1),
    prompt: z.string().trim().min(3).max(1000),
    duration,
    orientation,
    generateAudio: z.boolean().default(false),
    idempotencyKey,
  }),
  z.object({
    kind: z.literal("product_ad"),
    inputPaths: referenceImagePaths.min(1).max(MAX_REFERENCE_IMAGES),
    productInfo: z.string().trim().max(2500),
    concept: z.string().trim().max(3500),
    duration,
    orientation,
    resolution: z.enum(["480p", "720p", "1080p"]),
    productCategory: z.enum(productCategories).default("general"),
    generateAudio: z.boolean().default(false),
    idempotencyKey,
  }),
  z.object({
    kind: z.literal("product_ugc"),
    // 必须同时提供人物参考图与商品图：Prompt 固定按 [图1] 人物、[图2] 商品编排。
    inputPaths: referenceImagePaths.length(2),
    productInfo: z.string().trim().max(2500),
    script: z.string().trim().min(3).max(3500),
    duration: z.number().int().min(4).max(12),
    orientation: z.literal("portrait"),
    productCategory: z.enum(productCategories).default("general"),
    generateAudio: z.boolean().default(true),
    idempotencyKey,
  }),
]);

export type VideoJobInput = z.infer<typeof videoJobInputSchema>;

/** 存库前移除幂等令牌：重新生成时必须生成新的任务，不能命中唯一索引。 */
export function withoutIdempotencyKey(input: VideoJobInput): VideoJobInput {
  const rest: Record<string, unknown> = { ...input };
  delete rest.idempotencyKey;
  return rest as VideoJobInput;
}
