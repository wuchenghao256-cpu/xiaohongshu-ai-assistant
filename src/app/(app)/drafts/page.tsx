import { ConfigurationAlert } from "@/components/configuration-alert";
import { DraftList, type DraftView } from "@/components/drafts/draft-list";
import { PageHeader } from "@/components/page-header";
import { draftAssetIds, draftSelectColumns, type ContentDraftRow } from "@/lib/drafts/types";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function DraftsPage() {
  const configured = Boolean(getSupabasePublicEnv());
  let drafts: DraftView[] = [];

  if (configured) {
    const supabase = await createClient();
    const result = await supabase
      .from("content_drafts")
      .select(draftSelectColumns)
      .order("updated_at", { ascending: false });
    const rows = (result.data ?? []) as ContentDraftRow[];

    // 签名链接 1 小时过期，所以每次进页面重新签，不把 URL 存进数据库。
    const assetIds = draftAssetIds(rows);
    const signedById = new Map<string, string>();
    if (assetIds.length) {
      const assetsResult = await supabase
        .from("assets")
        .select("id,storage_bucket,storage_path,original_name")
        .in("id", assetIds);
      const signed = await Promise.all((assetsResult.data ?? []).map(async (asset) => {
        const url = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
        return url.data?.signedUrl ? { ...asset, url: url.data.signedUrl } : null;
      }));
      for (const asset of signed) {
        if (asset) signedById.set(asset.id, asset.url);
      }
    }

    drafts = rows.map((row) => {
      const sourceUrl = row.source_asset_id ? signedById.get(row.source_asset_id) : undefined;
      const generatedUrl = row.generated_asset_id ? signedById.get(row.generated_asset_id) : undefined;
      return {
        id: row.id,
        taskId: row.task_id,
        platform: row.platform,
        title: row.title,
        body: row.body,
        hashtags: row.hashtags,
        prompt: row.prompt,
        template: row.template,
        stylePreset: row.style_preset,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sourceImage: sourceUrl ? { id: `${row.id}-source`, src: sourceUrl, alt: "草稿参考图" } : undefined,
        generatedImage: generatedUrl ? { id: `${row.id}-generated`, src: generatedUrl, alt: row.title || "草稿生成图" } : undefined,
      };
    });
  }

  return (
    <>
      <PageHeader title="草稿箱" description="保存过的生成结果，可再次编辑文案并发布" />
      <div className="flex flex-col gap-5 p-4 sm:p-8">
        {!configured ? <ConfigurationAlert /> : null}
        <DraftList initialDrafts={drafts} />
      </div>
    </>
  );
}
