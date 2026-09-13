import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { HistoryList, type HistoryPost } from "@/components/history/history-list";
import { PageHeader } from "@/components/page-header";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function HistoryPage() {
  const configured = Boolean(getSupabasePublicEnv());
  let posts: HistoryPost[] = [];
  if (configured) {
    const supabase = await createClient();
    const result = await supabase.from("posts").select("id,task_id,title,body,hashtags,publish_status,updated_at").order("updated_at", { ascending: false });
    const taskIds = (result.data ?? []).map((post) => post.task_id);
    const assetsByTask = new Map<string, HistoryPost["images"]>();
    if (taskIds.length) {
      const assetsResult = await supabase.from("assets").select("id,task_id,storage_bucket,storage_path,original_name").in("task_id", taskIds).order("created_at");
      const signedAssets = await Promise.all((assetsResult.data ?? []).map(async (asset) => {
        const signed = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
        return signed.data?.signedUrl ? { ...asset, signedUrl: signed.data.signedUrl } : null;
      }));
      for (const asset of signedAssets) {
        if (!asset) continue;
        const images = assetsByTask.get(asset.task_id) ?? [];
        images.push({ id: asset.id, src: asset.signedUrl, alt: asset.original_name });
        assetsByTask.set(asset.task_id, images);
      }
    }
    posts = (result.data ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      body: post.body,
      hashtags: post.hashtags,
      publish_status: post.publish_status,
      updated_at: post.updated_at,
      images: assetsByTask.get(post.task_id) ?? [],
    }));
  }
  return <><PageHeader title="历史记录" description="查看、编辑和管理生成过的内容" actions={<Button nativeButton={false} render={<Link href="/create" />}><Plus data-icon="inline-start" />创建内容</Button>} /><div className="flex flex-col gap-5 p-4 sm:p-8">{!configured ? <ConfigurationAlert /> : null}<HistoryList initialPosts={posts} /></div></>;
}
