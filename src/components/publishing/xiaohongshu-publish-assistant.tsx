"use client";

import { CheckCircle2, Copy, Download, ImageIcon, Loader2, Share2, Sparkles } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fileNameFromDisposition, triggerDownload } from "@/lib/sharing/download-file";
import {
  canUseSystemShare,
  classifyShareOutcome,
  composeFinalCopy,
  coverCandidates,
  FALLBACK_NOTICE,
  missingSelection,
  prepareButtonLabel,
  shareVideoFileName,
} from "@/lib/sharing/xiaohongshu-publish";
import { cn } from "@/lib/utils";

export type AssistantVideo = { id: string; playbackUrl: string; createdAt: string; label: string };
export type AssistantCopy = { id: string; title: string; body: string; hashtags: string[]; origin: "final" | "draft" };
export type AssistantCover = { id: string; url: string; label: string; source: "video" | "copy" };

/** 视频下载接口只有这一条地址；卡片上的「下载视频」与助手里的「准备发布」共用它。 */
export function videoDownloadUrl(jobId: string) {
  return `/api/video-jobs/${jobId}/download`;
}

/**
 * 取视频字节。**不直接用签名地址**：那是跨域且一小时过期的链接，
 * 跨域下 `download` 属性会被浏览器忽略，过期后连点开都是 403。
 */
async function fetchVideoBlob(jobId: string) {
  const response = await fetch(videoDownloadUrl(jobId), { cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? "视频读取失败，请稍后重试。");
  }
  const fileName = fileNameFromDisposition(response.headers.get("content-disposition"), shareVideoFileName(jobId));
  return { blob: await response.blob(), fileName };
}

/**
 * 统一的复制入口。返回是否成功，供「一键准备发布」判断要不要继续 ——
 * 文案没复制上就不该往下走，否则用户以为已经准备好了。
 */
async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyCard({
  item,
  selected,
  onSelect,
  selectionKey,
}: {
  item: AssistantCopy;
  selected: boolean;
  onSelect: () => void;
  selectionKey: string;
}) {
  const finalCopy = useMemo(() => composeFinalCopy(item), [item]);
  // 这两个状态按卡片存，因此切换选择不会让另一张卡片的「已复制」提示留在原地。
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  async function copy() {
    setCopying(true);
    const ok = await copyToClipboard(finalCopy);
    setCopying(false);
    setCopied(ok);
    if (ok) toast.success("文案已复制");
    else toast.error("复制失败，请长按选择文本复制");
  }

  return <div
    className={cn(
      "flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 transition-colors",
      selected && "border-primary/60 bg-accent/20",
    )}
    data-selection-key={selectionKey}
  >
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={item.origin === "final" ? "secondary" : "outline"}>
        {item.origin === "final" ? "最终文案" : "草稿"}
      </Badge>
      {selected ? <Badge><CheckCircle2 className="size-3" />已选文案</Badge> : null}
    </div>
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{item.title || "（无标题）"}</p>
      {/* 手机上卡片很窄，正文只给 3 行；这里不提供展开，避免卡片被撑得比视频还高。 */}
      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.body || "（无正文）"}</p>
      {item.hashtags.length ? (
        <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
          {item.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}
        </p>
      ) : null}
    </div>
    {/* 手机上两个按钮各占一半，避免出现「复制」这种短标签旁边挤着一个长标签。 */}
    <div className="grid grid-cols-2 gap-2">
      <Button type="button" variant="outline" size="sm" className="w-full min-w-0" disabled={copying} onClick={() => void copy()}>
        {copying ? <Loader2 data-icon="inline-start" className="animate-spin" /> : copied ? <CheckCircle2 data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {copied ? "已复制" : "复制"}
      </Button>
      <Button type="button" variant={selected ? "default" : "outline"} size="sm" className="w-full min-w-0" onClick={onSelect}>
        {selected ? "已选发布" : "选择发布"}
      </Button>
    </div>
  </div>;
}

export function XiaohongshuPublishAssistant({
  videos,
  copies,
  coversByVideo,
  coversByCopy,
}: {
  videos: AssistantVideo[];
  copies: AssistantCopy[];
  coversByVideo: Record<string, AssistantCover[]>;
  coversByCopy: Record<string, AssistantCover[]>;
}) {
  const [videoId, setVideoId] = useState<string | null>(videos[0]?.id ?? null);
  const [copyId, setCopyId] = useState<string | null>(copies[0]?.id ?? null);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "sharing">("idle");
  const [note, setNote] = useState<string | null>(null);
  // 详情页拿到的视频每张卡片一个下载状态，避免点一个按钮所有卡片一起转圈。
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const video = useMemo(() => videos.find((item) => item.id === videoId) ?? null, [videos, videoId]);
  const copy = useMemo(() => copies.find((item) => item.id === copyId) ?? null, [copies, copyId]);
  const covers = useMemo(
    () => coverCandidates({ videoFrames: video ? coversByVideo[video.id] : [], copyImages: copy ? coversByCopy[copy.id] : [] }),
    [video, copy, coversByVideo, coversByCopy],
  );
  // 封面换了视频/文案之后可能不再存在于候选里，此时按「未选择」处理，不留一个悬空的高亮。
  const selectedCover = covers.find((item) => item.id === coverId) ?? null;
  const finalCopy = copy ? composeFinalCopy(copy) : "";

  async function downloadVideo(target: AssistantVideo) {
    setDownloadingId(target.id);
    try {
      const { blob, fileName } = await fetchVideoBlob(target.id);
      triggerDownload(blob, fileName);
      toast.success("视频已开始下载");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频下载失败，请稍后重试。");
    } finally {
      setDownloadingId(null);
    }
  }

  async function copyNow() {
    if (!copy) return;
    if (await copyToClipboard(finalCopy)) toast.success("文案已复制");
    else toast.error("复制失败，请长按选择文本复制");
  }

  function openDialog() {
    const missing = missingSelection(videoId, copyId);
    if (missing) {
      toast.error(missing);
      return;
    }
    setNote(null);
    setPhase("idle");
    setDialogOpen(true);
  }

  /**
   * 「一键准备发布」。顺序是刻意的：
   *   复制文案 → 准备视频文件 → 系统分享 → 失败则回退下载。
   *
   * 复制必须**排在分享前面**：navigator.share 会把页面切到后台，回到前台后再写剪贴板
   * 通常会被浏览器以「非用户手势」拒绝，那时用户就是文案没复制、视频也没分享成。
   */
  async function prepare() {
    if (!video || !copy || phase !== "idle") return;
    setPhase("preparing");
    setNote(null);

    if (!(await copyToClipboard(finalCopy))) {
      setPhase("idle");
      setNote("文案复制失败，请手动复制后再试。");
      return;
    }

    let blob: Blob;
    let fileName: string;
    try {
      ({ blob, fileName } = await fetchVideoBlob(video.id));
    } catch (error) {
      setPhase("idle");
      setNote(`${error instanceof Error ? error.message : "视频读取失败。"}（文案已复制）`);
      return;
    }

    const file = new File([blob], fileName, { type: blob.type || "video/mp4", lastModified: Date.now() });
    const supportsShare = canUseSystemShare(navigator.share?.bind(navigator), navigator.canShare?.bind(navigator));
    // 只有浏览器**明确**说这个文件能分享才走系统面板；canShare 不存在时不能猜测它支持。
    const shareable = supportsShare && navigator.canShare({ files: [file] });

    if (shareable) {
      setPhase("sharing");
      try {
        await navigator.share({ files: [file], title: copy.title || "小红书视频", text: finalCopy });
        const outcome = classifyShareOutcome(null);
        if (outcome.kind === "shared") {
          setPhase("idle");
          setNote("已发送到系统分享面板：选择「小红书」即可完成发布。（文案也已复制）");
          return;
        }
      } catch (error) {
        const outcome = classifyShareOutcome(error as { name?: string; message?: string });
        if (outcome.kind === "cancelled") {
          // 用户主动取消不是失败：文案已经复制好了，如实说明，不吓唬人也不重复下载。
          setPhase("idle");
          setNote("已取消分享。文案已经复制，你可以随时重试或直接打开小红书粘贴。");
          return;
        }
      }
    }

    // 走到这里只有两种可能：设备不支持文件分享，或系统面板打不开。
    // 两条路径都回退成「下载视频 + 文案已复制」。
    try {
      triggerDownload(blob, fileName);
      setNote(FALLBACK_NOTICE);
    } catch {
      setNote("视频保存失败，请用卡片上的「下载视频」按钮重试。（文案已复制）");
    }
    setPhase("idle");
  }

  const busy = phase !== "idle";

  if (!videos.length && !copies.length) {
    return <div className="p-4 sm:p-8">
      <Alert>
        <AlertDescription>
          还没有可发布的素材。请先在「AI视频」里生成一条视频，并在「AI创作」里生成一条文案。
        </AlertDescription>
      </Alert>
    </div>;
  }

  /**
   * `w-full` 不能省。这个应用是「column 方向的 flex body」，而 `mx-auto` + `max-w-6xl`
   * 的块在那种父级里按 fit-content 布局，不是撑满 —— 于是下面 `truncate`（white-space: nowrap）
   * 的文案会把整个容器顶到 420px，在 360px 的机器上直接裁掉 60px。
   */
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
    {/* 已选摘要：手机上吸顶，滚动选素材时始终能看到自己选了什么。 */}
    <div className="z-10 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur sm:sticky sm:top-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">已选视频 + 已选文案</p>
        <p className="mt-1 truncate text-sm font-medium">
          {video ? video.label : "未选视频"}
          <span className="mx-1.5 text-muted-foreground">+</span>
          {copy ? (copy.title || "（无标题文案）") : "未选文案"}
        </p>
      </div>
      <Button type="button" size="lg" className="w-full shrink-0 sm:w-auto" onClick={openDialog}>
        <Sparkles data-icon="inline-start" />发布到小红书
      </Button>
    </div>

    {/* 第一步：选视频 */}
    <section aria-labelledby="assistant-videos">
      <div className="mb-3">
        <h2 id="assistant-videos" className="font-semibold">1. 选择视频</h2>
        <p className="mt-1 text-sm text-muted-foreground">只显示已经生成完成的视频。</p>
      </div>
      {videos.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {videos.map((item) => {
          const selected = item.id === videoId;
          return <div
            key={item.id}
            className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 transition-colors", selected && "border-primary/60 bg-accent/20")}
          >
            <video className="aspect-video w-full rounded-md bg-black" src={item.playbackUrl} controls playsInline preload="metadata" />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.label}</span>
              {selected ? <Badge><CheckCircle2 className="size-3" />已选视频</Badge> : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full min-w-0"
                disabled={downloadingId === item.id}
                onClick={() => void downloadVideo(item)}
              >
                {downloadingId === item.id ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
                下载视频
              </Button>
              <Button
                type="button"
                variant={selected ? "default" : "outline"}
                size="sm"
                className="w-full min-w-0"
                onClick={() => setVideoId(item.id)}
              >
                {selected ? "已选发布" : "选择发布"}
              </Button>
            </div>
          </div>;
        })}
      </div> : <Alert><AlertDescription>还没有生成完成的视频，请先到「AI视频」生成一条。</AlertDescription></Alert>}
    </section>

    {/* 第二步：选文案 */}
    <section aria-labelledby="assistant-copies">
      <div className="mb-3">
        <h2 id="assistant-copies" className="font-semibold">2. 选择文案</h2>
        <p className="mt-1 text-sm text-muted-foreground">最终文案与草稿都可以直接选择。</p>
      </div>
      {copies.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {copies.map((item) => <CopyCard
          key={item.id}
          item={item}
          selected={item.id === copyId}
          selectionKey={item.id}
          onSelect={() => setCopyId(item.id)}
        />)}
      </div> : <Alert><AlertDescription>还没有可用的文案，请先到「AI创作」生成一条。</AlertDescription></Alert>}
    </section>

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!busy) setDialogOpen(open); }}>
      {/*
        弹窗在手机上必须让主按钮始终看得见。默认的 `max-h-[90vh] overflow-y-auto`
        会把整个弹窗（含底部按钮）做成一块滚动区：360×640 这类矮屏上，用户在弹窗里
        看到的是一段需要自己往下滚才找得到「一键准备发布」的内容 —— 这是本功能
        唯一的出口，不能被折在屏幕外。
        因此改成「弹窗整体定高 + flex 分栏」：只有中间素材区滚动，标题与按钮固定。
      */}
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发布到小红书</DialogTitle>
          <DialogDescription>确认素材后点「一键准备发布」：会复制文案并打开系统分享面板。</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">视频</p>
            {video ? <video className="aspect-video w-full rounded-md bg-black" src={video.playbackUrl} controls playsInline preload="metadata" /> : null}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">文案</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/20 p-3">
              <p className="text-sm font-medium">{copy?.title || "（无标题）"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{copy?.body || "（无正文）"}</p>
              {copy?.hashtags.length ? <p className="mt-2 break-words text-xs text-muted-foreground">{copy.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}</p> : null}
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2 w-full" disabled={busy} onClick={() => void copyNow()}>
              <Copy data-icon="inline-start" />复制文案
            </Button>
          </div>

          {/* 封面是可选的；没有任何候选时整块收起，而不是显示一个空框。 */}
          {covers.length ? <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">封面（可选）</p>
            <div className="flex flex-wrap gap-2">
              {covers.map((cover) => {
                const selected = cover.id === coverId;
                return <button
                  key={cover.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setCoverId(selected ? null : cover.id)}
                  aria-pressed={selected}
                  aria-label={`选择封面：${cover.label}`}
                  className={cn(
                    "relative size-16 shrink-0 overflow-hidden rounded-lg border transition-colors",
                    selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                  )}
                >
                  <Image unoptimized fill sizes="64px" src={cover.url} alt={cover.label} className="object-cover" />
                  {selected ? <span className="absolute inset-0 flex items-center justify-center bg-black/40"><CheckCircle2 className="size-5 text-white" /></span> : null}
                </button>;
              })}
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              {selectedCover ? <><ImageIcon className="size-3" />{selectedCover.label}</> : "不选则使用视频首帧作为封面。"}
            </p>
          </div> : null}

          {note ? <Alert><AlertDescription className="break-words text-xs">{note}</AlertDescription></Alert> : null}

          <p className="text-xs leading-5 text-muted-foreground">
            本功能只准备素材并打开系统分享面板，不会代替你在小红书上发布，也不使用任何非官方接口。
          </p>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDialogOpen(false)}>关闭</Button>
          <Button type="button" disabled={busy || !video || !copy} onClick={() => void prepare()}>
            {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Share2 data-icon="inline-start" />}
            {prepareButtonLabel(phase)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
