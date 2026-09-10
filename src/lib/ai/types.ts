import { z } from "zod";

export const writingStyles = ["真实分享", "种草", "测评", "干货", "故事型", "简洁", "自定义"] as const;

export const generationFieldsSchema = z.object({
  productName: z.string().trim().min(1, "请输入产品名称").max(120),
  category: z.string().trim().min(1, "请输入产品类别").max(80),
  description: z.string().trim().min(10, "产品描述至少 10 个字").max(2000),
  sellingPoints: z.string().trim().min(1, "请输入核心卖点").max(1000),
  targetAudience: z.string().trim().min(1, "请输入目标人群").max(500),
  price: z.string().trim().max(80).optional(),
  brandName: z.string().trim().max(100).optional(),
  style: z.enum(writingStyles),
  customStyle: z.string().trim().max(300).optional(),
  additionalInfo: z.string().trim().max(1500).optional(),
});

export const generationInputSchema = generationFieldsSchema.extend({
  taskId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).max(9).default([]),
}).superRefine((data, context) => {
  if (data.style === "自定义" && !data.customStyle) {
    context.addIssue({ code: "custom", path: ["customStyle"], message: "请描述自定义风格" });
  }
});

export type XiaohongshuGenerationInput = z.infer<typeof generationInputSchema>;

export const postVariantSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().min(1).max(50)).min(3).max(10),
  angle: z.string().trim().min(1).max(300),
  reasoning_summary: z.string().trim().min(1).max(500),
});

export const generatedVariantsSchema = z.object({
  variants: z.array(postVariantSchema).length(3),
}).superRefine(({ variants }, context) => {
  const normalizedTitles = new Set(variants.map((variant) => variant.title.trim().toLocaleLowerCase("zh-CN")));
  const normalizedAngles = new Set(variants.map((variant) => variant.angle.trim().toLocaleLowerCase("zh-CN")));
  if (normalizedTitles.size !== variants.length) {
    context.addIssue({ code: "custom", path: ["variants"], message: "三个版本的标题必须不同" });
  }
  if (normalizedAngles.size !== variants.length) {
    context.addIssue({ code: "custom", path: ["variants"], message: "三个版本的内容角度必须不同" });
  }
});

export type PostVariant = z.infer<typeof postVariantSchema>;
export type GeneratedVariants = z.infer<typeof generatedVariantsSchema>;

export type AiHealth = { ok: boolean; model: string; latencyMs?: number; message: string };
