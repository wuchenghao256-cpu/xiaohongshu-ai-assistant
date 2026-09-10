import Link from "next/link";
import { ArrowRight, Clock3, FileText, Plus, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import { getSupabasePublicEnv } from "@/lib/env";
import { formatDate, publishStatusLabels } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const configured = Boolean(getSupabasePublicEnv());
  let stats = { generations: 0, drafts: 0, ready: 0 }; let recent: Array<Record<string, unknown>> = [];
  if (configured) {
    const supabase = await createClient();
    const [generations, drafts, ready, posts] = await Promise.all([
      supabase.from("ai_generations").select("id", { count: "exact", head: true }).eq("status", "completed"),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("publish_status", "draft"),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("publish_status", "ready"),
      supabase.from("posts").select("id,title,publish_status,updated_at").order("updated_at", { ascending: false }).limit(5),
    ]);
    stats = { generations: generations.count ?? 0, drafts: drafts.count ?? 0, ready: ready.count ?? 0 }; recent = posts.data ?? [];
  }
  const statItems = [{ label: "总生成次数", value: stats.generations, icon: FileText }, { label: "草稿数量", value: stats.drafts, icon: Clock3 }, { label: "待发布数量", value: stats.ready, icon: Send }];
  return <><PageHeader title="工作台" description="查看内容生产进度和最近草稿" actions={<Button nativeButton={false} render={<Link href="/create" />}><Plus data-icon="inline-start" />创建内容</Button>} /><div className="flex flex-col gap-6 p-4 sm:p-8">{!configured ? <ConfigurationAlert /> : null}<section className="grid gap-4 md:grid-cols-3">{statItems.map((item) => <Card key={item.label}><CardHeader className="flex-row items-center justify-between"><CardDescription>{item.label}</CardDescription><item.icon className="size-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-3xl font-semibold tracking-tight">{configured ? item.value : "—"}</div></CardContent></Card>)}</section><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle>最近内容</CardTitle><CardDescription>最近编辑或生成的内容草稿</CardDescription></div><Button nativeButton={false} variant="ghost" size="sm" render={<Link href="/history" />}>全部记录<ArrowRight data-icon="inline-end" /></Button></CardHeader><CardContent>{recent.length ? <div className="flex flex-col divide-y">{recent.map((post) => <Link key={String(post.id)} href={`/posts/${post.id}`} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(post.title)}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(String(post.updated_at))}</p></div><Badge variant="secondary">{publishStatusLabels[String(post.publish_status)] ?? String(post.publish_status)}</Badge></Link>)}</div> : <div className="py-12 text-center text-sm text-muted-foreground">还没有内容，从创建第一个任务开始。</div>}</CardContent></Card></div></>;
}
