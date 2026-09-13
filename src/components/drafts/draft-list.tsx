"use client";

import { ExternalLink, Loader2, Pencil, Save, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ImagePreviewGallery, ImagePreviewTrigger, type PreviewImage } from "@/components/images/image-preview-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, publishStatusLabels } from "@/lib/format";

export type DraftView = {
  id: string;
  taskId: string;
  platform: string;
  title: string;
  body: string;
  hashtags: string[];
  prompt: string | null;
  template: string | null;
  stylePreset: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  sourceImage?: PreviewImage;
  generatedImage?: PreviewImage;
};

const platformLabels: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  weibo: "微博",
  wechat_moments: "微信朋友圈",
};

export function DraftList({ initialDrafts }: { initialDrafts: DraftView[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [editing, setEditing] = useState<DraftView | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<DraftView | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/drafts/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editing.title, body: editing.body, hashtags: editing.hashtags, platform: editing.platform }),
      });
      const data = (await response.json()) as { draft?: { updated_at: string }; error?: string };
      if (!response.ok || !data.draft) throw new Error(data.error || "草稿更新失败。");
      setDrafts((current) => current.map((item) => item.id === editing.id
        ? { ...editing, updatedAt: data.draft!.updated_at }
        : item));
      setEditing(null);
      toast.success("草稿已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "草稿更新失败。");
    } finally {
      setSaving(false);
    }
  }

  async function publish(draft: DraftView) {
    if (publishingId) return;
    setPublishingId(draft.id);
    try {
      // 发布走发布中心：这里只负责把文案提升为 final 并标记草稿已发布。
      const promote = await fetch(`/api/tasks/${draft.taskId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: draft.taskId, title: draft.title, body: draft.body, hashtags: draft.hashtags }),
      });
      const promoted = (await promote.json()) as { postId?: string; imageCount?: number; error?: string };
      if (!promote.ok || !promoted.postId) throw new Error(promoted.error || "准备发布失败。");
      if (!promoted.imageCount) throw new Error("这条草稿没有可用图片，请先补生成图片。");
      const marked = await fetch(`/api/drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      });
      if (!marked.ok) {
        const failed = (await marked.json()) as { error?: string };
        toast.error(failed.error || "草稿状态更新失败，但内容已可发布。");
      } else {
        setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, status: "published" } : item));
      }
      router.push(`/publishing?postId=${promoted.postId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "准备发布失败。");
      setPublishingId(undefined);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/drafts/${deleteTarget.id}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败。");
      setDrafts((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("草稿已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setDeleting(false);
    }
  }

  if (!drafts.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Save className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">还没有保存的草稿</p>
            <p className="mt-1 text-sm text-muted-foreground">
              在「创作」页生成图片后，点击「保存草稿」即可在这里回访、编辑和发布。
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/create" />}>
            去创作
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        {drafts.map((draft) => {
          const images = [draft.sourceImage, draft.generatedImage].filter(Boolean) as PreviewImage[];
          return (
            <Card key={draft.id} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{draft.title || "未命名草稿"}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {platformLabels[draft.platform] ?? draft.platform} · 更新于 {formatDate(draft.updatedAt)}
                  </p>
                </div>
                <Badge variant={draft.status === "published" ? "default" : "secondary"}>
                  {draft.status === "published" ? "已发布" : publishStatusLabels.draft}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                {images.length ? (
                  <ImagePreviewGallery images={images}>
                    {({ openPreview }) => (
                      <div className="mb-4 flex gap-3">
                        {images.map((image, index) => (
                          <div key={image.id} className="relative size-24 shrink-0 overflow-hidden rounded-lg border">
                            <ImagePreviewTrigger image={image} onOpen={() => openPreview(index)} sizes="96px" />
                            <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-background/90 px-1 py-0.5 text-center text-[10px] font-medium">
                              {index === 0 ? "参考图" : "生成图"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </ImagePreviewGallery>
                ) : (
                  <p className="mb-4 rounded-lg border border-dashed bg-muted/15 px-3 py-4 text-center text-xs text-muted-foreground">
                    这条草稿关联的图片已被删除。
                  </p>
                )}
                <p className="line-clamp-3 min-h-12 text-sm leading-6 text-muted-foreground">
                  {draft.body || "还没有文案"}
                </p>
                <div className="mt-3 flex flex-wrap gap-1 text-xs text-muted-foreground">
                  {draft.template ? <span className="rounded bg-muted px-1.5 py-0.5">模板：{draft.template}</span> : null}
                  {draft.stylePreset ? <span className="rounded bg-muted px-1.5 py-0.5">风格：{draft.stylePreset}</span> : null}
                  <span className="rounded bg-muted px-1.5 py-0.5">{draft.hashtags.length} 个标签</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(draft)}>
                    <Pencil data-icon="inline-start" />编辑文案
                  </Button>
                  <Button type="button" size="sm" disabled={Boolean(publishingId)} onClick={() => void publish(draft)}>
                    {publishingId === draft.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
                    {publishingId === draft.id ? "发布中…" : "发布"}
                  </Button>
                  <Button nativeButton={false} variant="ghost" size="sm" render={<Link href={`/create?taskId=${draft.taskId}`} />}>
                    <ExternalLink data-icon="inline-start" />回到创作
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(draft)}
                  >
                    <Trash2 data-icon="inline-start" />删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DialogContent showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>编辑草稿</DialogTitle>
            <DialogDescription>修改后保存，刷新页面不会丢失。</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="draft-edit-title">标题</FieldLabel>
                <Input
                  id="draft-edit-title"
                  value={editing.title}
                  maxLength={120}
                  onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="draft-edit-body">文案</FieldLabel>
                <Textarea
                  id="draft-edit-body"
                  className="min-h-44 leading-6"
                  value={editing.body}
                  onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="draft-edit-tags">标签</FieldLabel>
                <Input
                  id="draft-edit-tags"
                  value={editing.hashtags.join(" ")}
                  onChange={(event) => setEditing({
                    ...editing,
                    hashtags: event.target.value.split(/[\s,，]+/).filter(Boolean).map((tag) => tag.replace(/^#/, "")),
                  })}
                />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>取消</Button>
            <Button type="button" disabled={saving} onClick={saveEdit}>
              {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
              {saving ? "正在保存…" : "保存修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>确定删除这条草稿吗？</DialogTitle>
            <DialogDescription>只删除草稿记录，生成出来的图片仍保留在素材库。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Trash2 data-icon="inline-start" />}
              {deleting ? "正在删除…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
