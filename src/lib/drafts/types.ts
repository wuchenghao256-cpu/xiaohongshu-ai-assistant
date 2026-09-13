import { z } from "zod";

/** 草稿的字段白名单，避免把请求体里的任意键写进表。 */
export const draftPayloadSchema = z.object({
  taskId: z.string().uuid(),
  platform: z.string().trim().min(1).max(40).default("xiaohongshu"),
  title: z.string().trim().max(120).default(""),
  body: z.string().max(5000).default(""),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  // 这里只接受 assets.id，不接受任意 URL：成图 URL 是 1 小时过期的签名链接，
  // 存进数据库下次打开就是死链，所以统一在读取时重新签名。
  sourceAssetId: z.string().uuid().nullish(),
  generatedAssetId: z.string().uuid().nullish(),
  prompt: z.string().max(8000).nullish(),
  template: z.string().max(200).nullish(),
  stylePreset: z.string().max(60).nullish(),
  coverUrl: z.string().max(2000).nullish(),
});

/**
 * PATCH 用独立 schema，不能写成 draftPayloadSchema.partial()：
 * Zod 的 .partial() 会保留 .default()，于是只改 status 的请求也会被补上
 * platform/title/body/hashtags 的默认值，把草稿的文案静默清空。
 */
export const draftUpdateSchema = z.object({
  platform: z.string().trim().min(1).max(40).optional(),
  title: z.string().trim().max(120).optional(),
  body: z.string().max(5000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  sourceAssetId: z.string().uuid().nullish(),
  generatedAssetId: z.string().uuid().nullish(),
  prompt: z.string().max(8000).nullish(),
  template: z.string().max(200).nullish(),
  stylePreset: z.string().max(60).nullish(),
  coverUrl: z.string().max(2000).nullish(),
  status: z.enum(["draft", "published"]).optional(),
}).refine((value) => Object.keys(value).length > 0, "没有可更新的草稿字段");

export type DraftPayload = z.infer<typeof draftPayloadSchema>;

export type ContentDraftRow = {
  id: string;
  user_id: string;
  task_id: string;
  platform: string;
  title: string;
  body: string;
  hashtags: string[];
  source_asset_id: string | null;
  generated_asset_id: string | null;
  prompt: string | null;
  template: string | null;
  style_preset: string | null;
  cover_url: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export const draftSelectColumns =
  "id,user_id,task_id,platform,title,body,hashtags,source_asset_id,generated_asset_id,prompt,template,style_preset,cover_url,status,published_at,created_at,updated_at";

/** 把已存在的字段转成待写入的行；undefined 表示「不改这一列」。 */
export function toDraftRow(input: Partial<DraftPayload>) {
  const row: Record<string, string | string[] | null> = {};
  if (input.platform !== undefined) row.platform = input.platform;
  if (input.title !== undefined) row.title = input.title;
  if (input.body !== undefined) row.body = input.body;
  if (input.hashtags !== undefined) row.hashtags = input.hashtags;
  if (input.prompt !== undefined) row.prompt = input.prompt ?? null;
  if (input.template !== undefined) row.template = input.template ?? null;
  if (input.stylePreset !== undefined) row.style_preset = input.stylePreset ?? null;
  if (input.coverUrl !== undefined) row.cover_url = input.coverUrl ?? null;
  // null 是有效值（用户清空了成图），nullish 的 undefined 才是「不修改」。
  if (input.sourceAssetId !== undefined) row.source_asset_id = input.sourceAssetId ?? null;
  if (input.generatedAssetId !== undefined) row.generated_asset_id = input.generatedAssetId ?? null;
  return row;
}

/**
 * 收集草稿里引用的素材 id（去重）。批量签名一次，避免每行草稿各发一次 Storage 请求。
 */
export function draftAssetIds(drafts: Pick<ContentDraftRow, "source_asset_id" | "generated_asset_id">[]) {
  const ids = new Set<string>();
  for (const draft of drafts) {
    if (draft.source_asset_id) ids.add(draft.source_asset_id);
    if (draft.generated_asset_id) ids.add(draft.generated_asset_id);
  }
  return [...ids];
}
