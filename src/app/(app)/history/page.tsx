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
    const result = await (await createClient()).from("posts").select("id,title,body,hashtags,publish_status,updated_at").order("updated_at", { ascending: false });
    posts = (result.data ?? []) as HistoryPost[];
  }
  return <><PageHeader title="历史记录" description="查看、编辑和管理生成过的内容" actions={<Button nativeButton={false} render={<Link href="/create" />}><Plus data-icon="inline-start" />创建内容</Button>} /><div className="flex flex-col gap-5 p-4 sm:p-8">{!configured ? <ConfigurationAlert /> : null}<HistoryList initialPosts={posts} /></div></>;
}
