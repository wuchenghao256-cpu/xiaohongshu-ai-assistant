import { notFound } from "next/navigation";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { PostEditor } from "@/components/posts/post-editor";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!getSupabasePublicEnv()) return <><PageHeader title="内容详情" description="编辑草稿并准备人工发布" /><div className="p-4 sm:p-8"><ConfigurationAlert /></div></>;
  const supabase = await createClient(); const postResult = await supabase.from("posts").select("id,task_id,title,body,hashtags,status,publish_status").eq("id", id).single(); if (postResult.error || !postResult.data) notFound();
  const assetsResult = await supabase.from("assets").select("id,original_name,storage_path,selected_for_publishing").eq("task_id", postResult.data.task_id).order("created_at");
  const assets = await Promise.all((assetsResult.data ?? []).map(async (asset) => { const signed = await supabase.storage.from("product-assets").createSignedUrl(asset.storage_path, 3600); return { id: asset.id, name: asset.original_name, url: signed.data?.signedUrl ?? "", selected: asset.selected_for_publishing }; }));
  return <><PageHeader title="内容详情" description="编辑草稿并准备人工发布" /><PostEditor initialPost={postResult.data} assets={assets.filter((asset) => asset.url)} /></>;
}
