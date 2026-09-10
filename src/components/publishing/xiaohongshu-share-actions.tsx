"use client";

import { Copy, Loader2, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  isSupportedShareImageType,
  safeShareFileName,
  type SupportedShareImageType,
} from "@/lib/sharing/share-images";

type ShareImage = {
  id: string;
  name: string;
  mimeType: string;
  url: string;
};

type PreparationState =
  | { status: "preparing"; files: File[] }
  | { status: "ready"; files: File[] }
  | { status: "unsupported"; files: File[] }
  | { status: "error"; files: File[]; message: string };

function finalCopy(post: { title: string; body: string; hashtags: string[] }) {
  const hashtags = post.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ");
  return [post.title.trim(), post.body.trim(), hashtags].filter(Boolean).join("\n\n");
}

function uniqueFileName(name: string, usedNames: Set<string>) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  let duplicate = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem}-${duplicate++}${extension}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function XiaohongshuShareActions({
  post,
  selectionKey,
  hasSelectedImages,
  size = "default",
}: {
  post: { id: string; title: string; body: string; hashtags: string[] };
  selectionKey: string;
  hasSelectedImages: boolean;
  size?: "sm" | "default";
}) {
  const [preparation, setPreparation] = useState<PreparationState>({ status: "preparing", files: [] });
  const [sharing, setSharing] = useState(false);
  const copy = finalCopy(post);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (!hasSelectedImages) {
        setPreparation({ status: "error", files: [], message: "请先选择并保存待发布图片。" });
        return;
      }
      if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
        setPreparation({ status: "unsupported", files: [] });
        return;
      }

      setPreparation({ status: "preparing", files: [] });
      try {
        const response = await fetch(`/api/posts/${post.id}/share-images`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as { images?: ShareImage[]; error?: string };
        if (!response.ok || !data.images?.length) {
          throw new Error(data.error ?? "没有可分享的发布图片。");
        }

        const usedNames = new Set<string>();
        const files = await Promise.all(data.images.map(async (image, index) => {
          if (!isSupportedShareImageType(image.mimeType)) {
            throw new Error(`图片 ${image.name} 不是 JPEG、PNG 或 WebP。`);
          }
          const imageResponse = await fetch(image.url, { cache: "no-store", signal: controller.signal });
          if (!imageResponse.ok) throw new Error(`图片 ${image.name} 读取失败。`);
          const blob = await imageResponse.blob();
          const mimeType = image.mimeType as SupportedShareImageType;
          const name = uniqueFileName(safeShareFileName(image.name, index, mimeType), usedNames);
          return new File([blob], name, { type: mimeType, lastModified: Date.now() });
        }));

        if (controller.signal.aborted) return;
        setPreparation(navigator.canShare({ files })
          ? { status: "ready", files }
          : { status: "unsupported", files });
      } catch (error) {
        if (controller.signal.aborted) return;
        setPreparation({
          status: "error",
          files: [],
          message: error instanceof Error ? error.message : "分享图片准备失败。",
        });
      }
    })();

    return () => controller.abort();
  }, [hasSelectedImages, post.id, selectionKey]);

  function share() {
    if (preparation.status !== "ready") return;
    if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: preparation.files })) {
      setPreparation({ status: "unsupported", files: preparation.files });
      return;
    }

    try {
      const sharePromise = navigator.share({
        files: preparation.files,
        title: post.title,
        text: copy,
      });
      setSharing(true);
      void sharePromise
        .then(() => toast.success("图片已发送到分享面板，请在小红书完成发布。"))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          toast.error(error instanceof Error ? error.message : "无法打开系统分享面板。");
        })
        .finally(() => setSharing(false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开系统分享面板。");
    }
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(copy);
      toast.success("完整最终文案已复制");
    } catch {
      toast.error("复制失败，请手动复制文案。");
    }
  }

  const unsupported = preparation.status === "unsupported";
  const preparing = preparation.status === "preparing";

  return <div className="grid min-w-0 gap-2">
    {unsupported ? <Alert className="min-w-0 py-2">
      <AlertDescription className="break-words text-xs">
        当前设备暂不支持直接分享到小红书，请下载图片后发布。
      </AlertDescription>
    </Alert> : null}
    {preparation.status === "error" ? <p className="break-words text-xs text-destructive">{preparation.message}</p> : null}
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      {!unsupported ? <Button
        type="button"
        size={size}
        className="w-full min-w-0"
        disabled={preparing || preparation.status !== "ready" || sharing}
        onClick={share}
      >
        {preparing || sharing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Share2 data-icon="inline-start" />}
        {preparing ? "正在准备图片…" : sharing ? "正在打开分享面板…" : "一键分享到小红书"}
      </Button> : null}
      <Button type="button" variant="outline" size={size} className={unsupported ? "w-full min-w-0 sm:col-span-2" : "w-full min-w-0"} onClick={copyContent}>
        <Copy data-icon="inline-start" />复制文案
      </Button>
    </div>
  </div>;
}
