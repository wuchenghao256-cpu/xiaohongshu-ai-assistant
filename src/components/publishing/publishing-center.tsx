"use client";

import {
  Check,
  Copy,
  Download,
  Loader2,
  MessageCircle,
  Music2,
  Radio,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ImagePreviewGallery, ImagePreviewTrigger, type PreviewImage } from "@/components/images/image-preview-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { XiaohongshuShareActions } from "@/components/publishing/xiaohongshu-share-actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, publishStatusLabels } from "@/lib/format";
import type { Platform, PublishingCapability } from "@/lib/publishing/provider";
import { cn } from "@/lib/utils";

export type PublishingPost = {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  selectedImageCount: number;
  images: PreviewImage[];
};

export type PublishingJobView = {
  id: string;
  postId: string;
  postTitle: string;
  platform: Platform;
  provider: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

export type PlatformCapabilityView = PublishingCapability & {
  label: string;
  actionLabel: string;
};

const platformMeta: Record<Platform, { icon: typeof Send; tone: string }> = {
  xiaohongshu: { icon: Radio, tone: "bg-rose-50 text-rose-600" },
  douyin: { icon: Music2, tone: "bg-slate-100 text-slate-700" },
  weibo: { icon: Send, tone: "bg-orange-50 text-orange-600" },
  wechat_moments: { icon: MessageCircle, tone: "bg-emerald-50 text-emerald-600" },
};

const modeLabels = {
  official_api: "官方 API",
  manual_handoff: "人工交接",
  unavailable: "暂不可用",
};

const platformLabels: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  weibo: "微博",
  wechat_moments: "微信朋友圈",
};

async function copyText(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  toast.success(`${label}已复制`);
}

export function PublishingCenter({
  initialPosts,
  capabilities,
  initialJobs,
  initialPostId,
}: {
  initialPosts: PublishingPost[];
  capabilities: PlatformCapabilityView[];
  initialJobs: PublishingJobView[];
  initialPostId?: string;
}) {
  const [postId, setPostId] = useState(
    initialPostId && initialPosts.some((item) => item.id === initialPostId)
      ? initialPostId
      : (initialPosts[0]?.id ?? ""),
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(["xiaohongshu", "wechat_moments"]);
  const [jobs, setJobs] = useState(initialJobs);
  const [preparing, setPreparing] = useState(false);
  const post = useMemo(() => initialPosts.find((item) => item.id === postId), [initialPosts, postId]);

  // 从草稿列表点「发布」会带着 ?postId= 跳进来，此时把焦点滚到发布按钮，
  // 让「打开草稿 → 发布」这条路径不需要用户再找一次按钮。
  useEffect(() => {
    if (!initialPostId) return;
    document.getElementById("publishing-actions")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialPostId]);

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  }

  async function preparePublishing() {
    if (!post) {
      toast.error("请先选择一条最终内容。");
      return;
    }
    if (!selectedPlatforms.length) {
      toast.error("请至少选择一个发布平台。");
      return;
    }
    if (!post.selectedImageCount) {
      toast.error("这条内容没有选中的发布图片，请先在内容详情中选择。");
      return;
    }
    setPreparing(true);
    try {
      const response = await fetch("/api/publishing/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: post.id, platforms: selectedPlatforms }),
      });
      const data = await response.json() as { jobs?: PublishingJobView[]; error?: string };
      if (!response.ok || !data.jobs) throw new Error(data.error ?? "准备发布失败。");
      setJobs((current) => [...data.jobs!, ...current]);
      toast.success(`已为 ${data.jobs.length} 个平台创建发布任务`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "准备发布失败。");
    } finally {
      setPreparing(false);
    }
  }

  const hashtags = post?.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ") ?? "";
  const momentsContent = post ? `${post.body}\n\n${hashtags}`.trim() : "";

  return <div className="flex flex-col gap-6 p-4 sm:p-8">
    <Card>
      <CardHeader>
        <CardTitle className="text-base">选择内容</CardTitle>
        <CardDescription>以最终文案作为 canonical content；平台变体将在后续能力接入时单独生成。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <div>
          <label htmlFor="publishing-post" className="mb-2 block text-sm font-medium">最终内容</label>
          <Select value={postId} onValueChange={(value) => value && setPostId(value)}>
            <SelectTrigger id="publishing-post" className="w-full" disabled={!initialPosts.length}>
              <SelectValue>{post?.title ?? "暂无可发布的最终内容"}</SelectValue>
            </SelectTrigger>
            <SelectContent>{initialPosts.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">只显示已设为最终版本的内容。</p>
        </div>
        <div className="min-w-0 rounded-lg border bg-muted/20 p-4">
          {post ? <>
            <div className="flex items-start justify-between gap-4"><p className="truncate font-medium">{post.title}</p><span className="shrink-0 text-xs text-muted-foreground">{post.selectedImageCount} 张发布图</span></div>
            {post.images.length ? <ImagePreviewGallery images={post.images}>{({ openPreview }) => <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1">{post.images.map((image, index) => <div key={image.id} className="relative size-16 shrink-0 overflow-hidden rounded-lg border"><ImagePreviewTrigger image={image} onOpen={() => openPreview(index)} sizes="64px" /></div>)}</div>}</ImagePreviewGallery> : null}
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">{post.body}</p>
            <p className="mt-2 truncate text-xs text-muted-foreground">{hashtags || "暂无 hashtags"}</p>
          </> : <p className="py-4 text-center text-sm text-muted-foreground">请先在创建内容中选择最终文案。</p>}
        </div>
      </CardContent>
    </Card>

    <section aria-labelledby="platforms-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div><h2 id="platforms-title" className="font-semibold">选择平台</h2><p className="mt-1 text-sm text-muted-foreground">每个平台会创建一条独立 publishing job。</p></div>
        <span className="text-sm text-muted-foreground">已选 {selectedPlatforms.length} 个</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {capabilities.map((capability) => {
          const selected = selectedPlatforms.includes(capability.platform);
          const meta = platformMeta[capability.platform];
          const Icon = meta.icon;
          const isManual = capability.mode === "manual_handoff";
          return <Card key={capability.platform} className={cn("transition-colors", selected && "border-primary/50 bg-accent/20")}>
            <CardHeader className="flex-row items-start gap-3">
              <button type="button" role="checkbox" aria-checked={selected} aria-label={`选择${capability.label}`} onClick={() => togglePlatform(capability.platform)} className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors", selected ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background")}>
                {selected ? <Check className="size-3.5" /> : null}
              </button>
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", meta.tone)}><Icon className="size-4" /></div>
              <div className="min-w-0 flex-1"><CardTitle className="text-base">{capability.label}</CardTitle><CardDescription className="mt-1">{capability.reason}</CardDescription></div>
              <Badge variant="secondary">{capability.connected ? "已连接" : isManual ? "无需连接" : "未连接"}</Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-background p-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">发布方式</dt><dd className="mt-1 font-medium">{modeLabels[capability.mode]}</dd></div>
                <div><dt className="text-xs text-muted-foreground">当前内容状态</dt><dd className="mt-1 font-medium">{isManual ? "需要人工确认发布" : capability.connected ? "接口待接入" : "需要连接账号"}</dd></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {isManual ? <Button type="button" variant={selected ? "default" : "outline"} size="sm" onClick={() => { if (!selected) togglePlatform(capability.platform); }}>{capability.actionLabel}</Button> : <Button type="button" variant="outline" size="sm" disabled>{capability.actionLabel}</Button>}
                {post && capability.platform === "xiaohongshu" ? <div className="w-full min-w-0 pt-1">
                  <XiaohongshuShareActions
                    key={`${post.id}:${post.selectedImageCount}`}
                    post={post}
                    selectionKey={`${post.id}:${post.selectedImageCount}`}
                    hasSelectedImages={post.selectedImageCount > 0}
                    size="sm"
                  />
                </div> : null}
                {post && capability.platform === "wechat_moments" ? <Button type="button" variant="ghost" size="sm" onClick={() => copyText(momentsContent, "朋友圈文案")}><Copy data-icon="inline-start" />复制朋友圈文案</Button> : null}
              </div>
            </CardContent>
          </Card>;
        })}
      </div>
    </section>

    <div id="publishing-actions" className="z-10 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:sticky sm:bottom-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-medium">{post ? post.title : "尚未选择内容"}</p><p className="mt-0.5 text-xs text-muted-foreground">将为 {selectedPlatforms.length} 个平台分别创建任务，不会直接伪造发布成功。</p></div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button nativeButton={false} variant="outline" disabled={!post || !post.selectedImageCount} render={<a href={post ? `/api/posts/${post.id}/images.zip` : "#"} download="post-images.zip" />}><Download data-icon="inline-start" />一键下载全部图片 ZIP</Button>
        <Button type="button" disabled={preparing || !post || !selectedPlatforms.length} onClick={preparePublishing}>{preparing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}准备发布</Button>
      </div>
    </div>

    <Card>
      <CardHeader><CardTitle className="text-base">最近发布任务</CardTitle><CardDescription>任务状态来自真实 capability 判断；失败不会标记为已发布。</CardDescription></CardHeader>
      <CardContent>{jobs.length ? <div className="flex flex-col divide-y">{jobs.slice(0, 12).map((job) => <div key={job.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{job.postTitle}</p><p className="mt-1 text-xs text-muted-foreground">{platformLabels[job.platform]} · {formatDate(job.createdAt)}</p>{job.errorMessage ? <p className="mt-1 text-xs text-muted-foreground">{job.errorMessage}</p> : null}</div>
        <Badge variant="secondary">{publishStatusLabels[job.status] ?? job.status}</Badge>
      </div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">还没有发布任务。</p>}</CardContent>
    </Card>
  </div>;
}
