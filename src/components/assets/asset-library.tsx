"use client";

import { CheckCircle2, ImageIcon, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ImagePreviewGallery, ImagePreviewTrigger } from "@/components/images/image-preview-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export type LibraryAsset = {
  id: string;
  taskId: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  selected: boolean;
  createdAt: string;
  productName: string;
  origin: "uploaded" | "generated";
};

type Filter = "all" | "uploaded" | "generated";

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "uploaded", label: "上传的原图" },
  { value: "generated", label: "生成成功的图" },
];

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AssetLibrary({ initialAssets }: { initialAssets: LibraryAsset[] }) {
  const [assets, setAssets] = useState(initialAssets);
  const [filter, setFilter] = useState<Filter>("all");
  const [deleting, setDeleting] = useState<string>();
  const [toggling, setToggling] = useState<string>();

  const counts = useMemo(() => ({
    all: assets.length,
    uploaded: assets.filter((asset) => asset.origin === "uploaded").length,
    generated: assets.filter((asset) => asset.origin === "generated").length,
  }), [assets]);

  const visible = filter === "all" ? assets : assets.filter((asset) => asset.origin === filter);

  async function remove(asset: LibraryAsset) {
    if (deleting) return;
    setDeleting(asset.id);
    try {
      const response = await fetch(`/api/assets?id=${asset.id}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "删除失败。");
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      toast.success("图片已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setDeleting(undefined);
    }
  }

  async function toggleSelected(asset: LibraryAsset) {
    // 乐观切换：按钮样式和文案由 asset.selected 派生，等响应回来才变的话，
    // 慢请求时点下去等于没反应。失败时回滚。
    if (toggling) return;
    const selected = !asset.selected;
    setToggling(asset.id);
    setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, selected } : item));
    try {
      const response = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id, selected }),
      });
      const data = (await response.json()) as { asset?: { selected_for_publishing: boolean }; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error || "选择状态保存失败。");
      setAssets((current) => current.map((item) => item.id === asset.id
        ? { ...item, selected: data.asset!.selected_for_publishing }
        : item));
    } catch (error) {
      setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, selected: asset.selected } : item));
      toast.error(error instanceof Error ? error.message : "选择状态保存失败。");
    } finally {
      setToggling(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={filter === item.value ? "default" : "outline"}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
            <span className="ml-1 text-xs opacity-70">{counts[item.value]}</span>
          </Button>
        ))}
      </div>

      {visible.length ? (
        <ImagePreviewGallery images={visible.map((asset) => ({ id: asset.id, src: asset.url, alt: asset.name }))}>
          {({ openPreview }) => (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((asset, index) => (
                <Card key={asset.id} className="overflow-hidden pt-0">
                  <div className="relative aspect-square">
                    {/* 整块区域是预览触发点：素材库不能让用户点了没反应。 */}
                    <ImagePreviewTrigger
                      image={{ id: asset.id, src: asset.url, alt: asset.name }}
                      onOpen={() => openPreview(index)}
                      sizes="(max-width: 640px) 45vw, 240px"
                    />
                    <Badge
                      className="pointer-events-none absolute left-2 top-2"
                      variant={asset.origin === "generated" ? "default" : "secondary"}
                    >
                      {asset.origin === "generated" ? "生成图" : "原图"}
                    </Badge>
                  </div>
                  <CardContent className="flex flex-col gap-2 pt-3">
                    <p className="truncate text-sm font-medium" title={asset.name}>{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {asset.productName ? `${asset.productName} · ` : ""}
                      {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
                      {formatSize(asset.sizeBytes)} · {formatDate(asset.createdAt)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant={asset.selected ? "default" : "outline"}
                        size="xs"
                        disabled={toggling === asset.id}
                        onClick={() => void toggleSelected(asset)}
                      >
                        {toggling === asset.id ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <CheckCircle2 data-icon="inline-start" />
                        )}
                        {asset.selected ? "已选作发布图" : toggling === asset.id ? "保存中…" : "选作发布图"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={deleting === asset.id}
                        onClick={() => void remove(asset)}
                      >
                        {deleting === asset.id ? (
                          <Loader2 data-icon="inline-start" className="animate-spin" />
                        ) : (
                          <Trash2 data-icon="inline-start" />
                        )}
                        {deleting === asset.id ? "删除中…" : "删除"}
                      </Button>
                    </div>
                    <Button
                      nativeButton={false}
                      variant="outline"
                      size="xs"
                      render={<Link href={`/create?taskId=${asset.taskId}&insertAssetId=${asset.id}`} />}
                    >
                      <Plus data-icon="inline-start" />插入当前创作
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ImagePreviewGallery>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ImageIcon className="size-8 text-muted-foreground" />
            <div>
              <p className="font-medium">
                {assets.length ? "这个分类下还没有图片" : "素材库还是空的"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {assets.length
                  ? "切换到「全部」可以看到其余素材。"
                  : "上传商品参考图或生成图片后，原始图和生成成功的图都会显示在这里。"}
              </p>
            </div>
            <Button nativeButton={false} render={<Link href="/create" />}>
              去上传或生成
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 加载失败时复用同一套视觉，避免出现空白页。 */
export function AssetLibraryEmpty({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <ImageIcon className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium">素材库加载失败</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}
