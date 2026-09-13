import { AssetLibrary, AssetLibraryEmpty, type LibraryAsset } from "@/components/assets/asset-library";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function AssetsPage() {
  const configured = Boolean(getSupabasePublicEnv());
  let assets: LibraryAsset[] = [];
  let loadError: string | null = null;

  if (configured) {
    try {
      const supabase = await createClient();
      const result = await supabase
        .from("assets")
        .select("id,task_id,storage_bucket,storage_path,original_name,mime_type,size_bytes,width,height,selected_for_publishing,created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (result.error) throw result.error;
      const rows = result.data ?? [];

      // 商品名单独查一次，不用嵌套 select：assets 指向 content_tasks 的是复合外键
      // (task_id, user_id)，依赖 PostgREST 的关系推断容易脆断。
      const taskIds = [...new Set(rows.map((asset) => asset.task_id))];
      const namesByTask = new Map<string, string>();
      if (taskIds.length) {
        const tasks = await supabase.from("content_tasks").select("id,product_name").in("id", taskIds);
        if (tasks.error) throw tasks.error;
        for (const task of tasks.data ?? []) namesByTask.set(task.id, task.product_name ?? "");
      }

      // 签名链接 1 小时过期，因此每次进页面重新签；失败的行直接跳过而不是整页报错。
      const signed = await Promise.all(rows.map(async (asset) => {
        const url = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
        if (!url.data?.signedUrl) return null;
        return {
          id: asset.id,
          taskId: asset.task_id,
          name: asset.original_name,
          url: url.data.signedUrl,
          mimeType: asset.mime_type,
          sizeBytes: asset.size_bytes,
          width: asset.width,
          height: asset.height,
          selected: asset.selected_for_publishing,
          createdAt: asset.created_at,
          productName: namesByTask.get(asset.task_id) ?? "",
          // 生成图由 AI 命名（AI模特商品图-… / AI生成商品图-…），据此区分来源。
          origin: asset.original_name.startsWith("AI") ? "generated" as const : "uploaded" as const,
        };
      }));
      assets = signed.filter((asset): asset is LibraryAsset => asset !== null);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "读取素材失败。";
      console.error("Asset library load failed", { message: loadError });
    }
  }

  return (
    <>
      <PageHeader title="素材库" description="上传的原始图片与生成成功的图片，可预览、选择并插入当前创作" />
      <div className="p-4 sm:p-8">
        {!configured ? <ConfigurationAlert /> : loadError ? <AssetLibraryEmpty message={loadError} /> : <AssetLibrary initialAssets={assets} />}
      </div>
    </>
  );
}
