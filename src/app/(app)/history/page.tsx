import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { getSupabasePublicEnv } from "@/lib/env";
import { formatDate, publishStatusLabels } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function HistoryPage() {
  const configured = Boolean(getSupabasePublicEnv()); let posts: Array<Record<string, unknown>> = [];
  if (configured) { const result = await (await createClient()).from("posts").select("id,title,body,hashtags,publish_status,updated_at").order("updated_at", { ascending: false }); posts = result.data ?? []; }
  return <><PageHeader title="历史记录" description="查看、编辑和管理生成过的内容" actions={<Button nativeButton={false} render={<Link href="/create" />}><Plus data-icon="inline-start" />创建内容</Button>} /><div className="flex flex-col gap-5 p-4 sm:p-8">{!configured ? <ConfigurationAlert /> : null}{posts.length ? <div className="grid gap-4 xl:grid-cols-2">{posts.map((post) => <Card key={String(post.id)} className="transition-shadow hover:shadow-sm"><CardHeader className="flex-row items-start justify-between gap-4"><div className="min-w-0"><CardTitle className="truncate text-base">{String(post.title)}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{formatDate(String(post.updated_at))}</p></div><Badge variant="secondary">{publishStatusLabels[String(post.publish_status)]}</Badge></CardHeader><CardContent><p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{String(post.body)}</p><div className="mt-4 flex items-center justify-between"><span className="text-xs text-muted-foreground">{Array.isArray(post.hashtags) ? post.hashtags.length : 0} 个标签</span><Button nativeButton={false} variant="outline" size="sm" render={<Link href={`/posts/${post.id}`} />}>打开编辑</Button></div></CardContent></Card>)}</div> : <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><FileText className="size-8 text-muted-foreground" /><div><p className="font-medium">还没有保存的内容</p><p className="mt-1 text-sm text-muted-foreground">生成内容并设为最终版本后会显示在这里。</p></div></CardContent></Card>}</div></>;
}
