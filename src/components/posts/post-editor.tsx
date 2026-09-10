"use client";

import { CheckCircle2, Copy, Download, Loader2, Save, Send } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import { XiaohongshuShareActions } from "@/components/publishing/xiaohongshu-share-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { publishStatusLabels } from "@/lib/format";

type Post = {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  status: string;
  publish_status: string;
};

type Asset = { id: string; name: string; url: string; selected: boolean };

export function PostEditor({ initialPost, assets: initialAssets }: { initialPost: Post; assets: Asset[] }) {
  const [post, setPost] = useState(initialPost);
  const [assets, setAssets] = useState(initialAssets);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const selectedAssets = assets.filter((asset) => asset.selected);

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast.success(`${label}已复制`);
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: post.title, body: post.body, hashtags: post.hashtags }),
      });
      const data = await response.json() as { post?: Post; error?: string };
      if (!response.ok || !data.post) throw new Error(data.error);
      setPost(data.post);
      toast.success("草稿已保存");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function prepare() {
    if (post.status !== "final" || !post.title.trim() || !post.body.trim()) {
      toast.error("请先选择并保存最终文案，再准备发布。");
      return;
    }
    if (!selectedAssets.length) {
      toast.error("请至少选择并保存一张待发布图片。");
      return;
    }
    setPreparing(true);
    try {
      if (!(await save())) return;
      const response = await fetch(`/api/posts/${post.id}/ready`, { method: "POST" });
      const data = await response.json() as { post?: Post; error?: string };
      if (!response.ok || !data.post) throw new Error(data.error);
      setPost(data.post);
      toast.success("内容已准备好，请在小红书完成最终发布。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPreparing(false);
    }
  }

  async function toggleAsset(asset: Asset) {
    try {
      const selected = !asset.selected;
      const response = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id, selected }),
      });
      const data = await response.json() as { asset?: { id: string; selected_for_publishing: boolean }; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error);
      setAssets((value) => value.map((item) => item.id === asset.id
        ? { ...item, selected: data.asset!.selected_for_publishing }
        : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "图片选择保存失败");
    }
  }

  return <div className="grid min-w-0 gap-5 p-4 sm:p-8 xl:grid-cols-[minmax(0,1fr)_320px]">
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle>最终内容</CardTitle><CardDescription>修改后保存，发布前请再次核对事实与图片</CardDescription></div>
        <Badge variant="secondary" className="shrink-0">{publishStatusLabels[post.publish_status]}</Badge>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field><div className="flex items-center justify-between"><FieldLabel htmlFor="post-title">标题</FieldLabel><Button variant="ghost" size="xs" onClick={() => copy(post.title, "标题")}><Copy data-icon="inline-start" />复制</Button></div><Input id="post-title" value={post.title} onChange={(event) => setPost((value) => ({ ...value, title: event.target.value }))} /></Field>
          <Field><div className="flex items-center justify-between"><FieldLabel htmlFor="post-body">正文</FieldLabel><Button variant="ghost" size="xs" onClick={() => copy(post.body, "正文")}><Copy data-icon="inline-start" />复制</Button></div><Textarea id="post-body" className="min-h-80 leading-6" value={post.body} onChange={(event) => setPost((value) => ({ ...value, body: event.target.value }))} /></Field>
          <Field><div className="flex items-center justify-between"><FieldLabel htmlFor="post-tags">标签</FieldLabel><Button variant="ghost" size="xs" onClick={() => copy(post.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" "), "标签")}><Copy data-icon="inline-start" />复制</Button></div><Input id="post-tags" value={post.hashtags.join(" ")} onChange={(event) => setPost((value) => ({ ...value, hashtags: event.target.value.split(/[\s,，]+/).filter(Boolean).map((tag) => tag.replace(/^#/, "")) }))} /></Field>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={save} disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}保存草稿</Button>
            <Button onClick={prepare} disabled={preparing || post.publish_status === "ready"}>{preparing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}{post.publish_status === "ready" ? "已准备发布" : "准备发布"}</Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
    <aside className="flex min-w-0 flex-col gap-5">
      <Alert><CheckCircle2 /><AlertTitle>人工发布确认</AlertTitle><AlertDescription>图片可交给系统分享面板，但仍需在小红书内完成最终发布。</AlertDescription></Alert>
      <Card className="min-w-0">
        <CardHeader><CardTitle className="text-base">待发布图片</CardTitle><CardDescription>已选 {selectedAssets.length} / {assets.length} 张</CardDescription></CardHeader>
        <CardContent>{assets.length ? <div className="grid grid-cols-2 gap-2">{assets.map((asset) => <div key={asset.id} className="relative aspect-square min-w-0 overflow-hidden rounded-lg border"><Image unoptimized fill sizes="140px" src={asset.url} alt={asset.name} className={asset.selected ? "object-cover" : "object-cover opacity-45"} /><a href={`/api/assets/${asset.id}/download`} download={asset.name} className="absolute right-1 top-1 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium" aria-label={`下载 ${asset.name}`}>下载</a><button type="button" aria-pressed={asset.selected} onClick={() => toggleAsset(asset)} className="absolute inset-x-1 bottom-1 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium">{asset.selected ? "已选作发布图" : "选作发布图"}</button></div>)}</div> : <p className="text-sm text-muted-foreground">这个任务没有上传图片。</p>}</CardContent>
      </Card>
      <XiaohongshuShareActions
        key={selectedAssets.map((asset) => asset.id).sort().join(",")}
        post={post}
        selectionKey={selectedAssets.map((asset) => asset.id).sort().join(",")}
        hasSelectedImages={selectedAssets.length > 0}
      />
      <Button nativeButton={false} variant="outline" className="w-full" render={<a href={`/api/posts/${post.id}/images.zip`} download="post-images.zip" />}><Download data-icon="inline-start" />一键下载全部图片 ZIP</Button>
    </aside>
  </div>;
}
