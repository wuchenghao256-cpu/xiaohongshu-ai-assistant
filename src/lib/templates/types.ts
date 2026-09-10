import { z } from "zod";

export const templatePayloadSchema = z.object({
  name: z.string().trim().min(1, "请输入模板名称").max(120),
  productCategory: z.string().trim().max(80).default(""),
  targetAudience: z.string().trim().max(500).default(""),
  brand: z.string().trim().max(100).default(""),
  tone: z.string().trim().max(300).default(""),
  coreSellingPoints: z.string().trim().max(1000).default(""),
  additionalInfo: z.string().trim().max(1500).default(""),
  customInstructions: z.string().trim().max(1500).default(""),
  isDefault: z.boolean().default(false),
});

export const templateUpdateSchema = z.object({
  name: z.string().trim().min(1, "请输入模板名称").max(120).optional(),
  productCategory: z.string().trim().max(80).optional(),
  targetAudience: z.string().trim().max(500).optional(),
  brand: z.string().trim().max(100).optional(),
  tone: z.string().trim().max(300).optional(),
  coreSellingPoints: z.string().trim().max(1000).optional(),
  additionalInfo: z.string().trim().max(1500).optional(),
  customInstructions: z.string().trim().max(1500).optional(),
  isDefault: z.boolean().optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "没有可更新的模板字段",
);

export type TemplatePayload = z.infer<typeof templatePayloadSchema>;

export type ContentTemplate = {
  id: string;
  name: string;
  product_category: string | null;
  target_audience: string | null;
  brand: string | null;
  tone: string | null;
  core_selling_points: string | null;
  additional_info: string | null;
  custom_instructions: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export const templateSelectColumns = "id,name,product_category,target_audience,brand,tone,core_selling_points,additional_info,custom_instructions,is_default,created_at,updated_at";

export function toTemplateRow(input: Partial<TemplatePayload>) {
  const row: Record<string, string | boolean | null> = {};
  if (input.name !== undefined) row.name = input.name;
  if (input.productCategory !== undefined) row.product_category = input.productCategory || null;
  if (input.targetAudience !== undefined) row.target_audience = input.targetAudience || null;
  if (input.brand !== undefined) row.brand = input.brand || null;
  if (input.tone !== undefined) row.tone = input.tone || null;
  if (input.coreSellingPoints !== undefined) row.core_selling_points = input.coreSellingPoints || null;
  if (input.additionalInfo !== undefined) row.additional_info = input.additionalInfo || null;
  if (input.customInstructions !== undefined) row.custom_instructions = input.customInstructions || null;
  if (input.isDefault !== undefined) row.is_default = input.isDefault;
  return row;
}
