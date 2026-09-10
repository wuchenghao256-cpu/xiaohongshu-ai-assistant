"use client";

import Link from "next/link";
import { FileText, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, publishStatusLabels } from "@/lib/format";

export type HistoryPost = {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  publish_status: string;
  updated_at: string;
};

export function HistoryList({ initialPosts }: { initialPosts: HistoryPost[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [deleteTarget, setDeleteTarget] = useState<HistoryPost | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/posts/${deleteTarget.id}`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败，请稍后重试。");
      setPosts((current) => current.filter((post) => post.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("内容已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败，请稍后重试。");
    } finally {
      setDeleting(false);
    }
  }

  return <>
    {posts.length ? <div className="grid gap-4 xl:grid-cols-2">{posts.map((post) => <Card key={post.id} className="transition-shadow hover:shadow-sm">
      <CardHeader className="flex-row items-start justify-between gap-4"><div className="min-w-0"><CardTitle className="truncate text-base">{post.title}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{formatDate(post.updated_at)}</p></div><Badge variant="secondary">{publishStatusLabels[post.publish_status]}</Badge></CardHeader>
      <CardContent><p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{post.body}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{post.hashtags.length} 个标签</span><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDeleteTarget(post)}><Trash2 data-icon="inline-start" />删除</Button><Button nativeButton={false} variant="outline" size="sm" render={<Link href={`/posts/${post.id}`} />}>打开编辑</Button></div></div></CardContent>
    </Card>)}</div> : <Card><CardContent className="flex flex-col items-center gap-3 py-16 text-center"><FileText className="size-8 text-muted-foreground" /><div><p className="font-medium">还没有保存的内容</p><p className="mt-1 text-sm text-muted-foreground">生成内容并设为最终版本后会显示在这里。</p></div></CardContent></Card>}

    <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
      <DialogContent showCloseButton={!deleting}>
        <DialogHeader><DialogTitle>确定删除这条内容吗？</DialogTitle><DialogDescription>删除后，该内容关联的文案版本和相关记录将无法恢复。</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button><Button type="button" variant="destructive" disabled={deleting} onClick={confirmDelete}>{deleting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}{deleting ? "正在删除…" : "确认删除"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
