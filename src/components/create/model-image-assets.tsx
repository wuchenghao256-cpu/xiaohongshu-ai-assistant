"use client";

import { CheckCircle2, ImageIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useRef } from "react";
import { ImagePreviewGallery, ImagePreviewTrigger } from "@/components/images/image-preview-gallery";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkspaceImageAsset = {
  id: string;
  storagePath: string;
  name: string;
  preview: string;
  size: number;
  kind: "uploaded" | "generated";
};

const referenceRoles = [
  { type: "Primary Reference", detail: "Front · 正面" },
  { type: "Additional Reference", detail: "Back · 背面" },
  { type: "Additional Reference", detail: "Detail · 细节" },
  { type: "Additional Reference", detail: "Logo / Print Detail · 图案细节" },
] as const;

export function ReferenceImagesPanel({
  assets,
  uploading,
  disabled,
  onUpload,
  onDelete,
}: {
  assets: WorkspaceImageAsset[];
  uploading: boolean;
  disabled: boolean;
  onUpload: (files: FileList | null) => Promise<void>;
  onDelete: (asset: WorkspaceImageAsset) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = assets.length >= 4;

  return <section aria-labelledby="reference-images-title" className="min-w-0 rounded-xl border bg-background p-3">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 id="reference-images-title" className="text-sm font-semibold">Reference Images（参考图）</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">最多 4 张，顺序依次用于正面、背面、细节和图案细节。</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{assets.length} / 4</span>
    </div>

    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      className="sr-only !w-px"
      onChange={(event) => {
        const input = event.currentTarget;
        void onUpload(event.target.files).finally(() => { input.value = ""; });
      }}
    />
    <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading || atLimit} className="mt-3 flex min-h-20 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/20 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/45 disabled:cursor-not-allowed disabled:opacity-50">
      {uploading ? <Loader2 className="size-5 animate-spin" /> : <UploadCloud className="size-5" />}
      <span>{uploading ? "正在上传参考图…" : atLimit ? "已达到 4 张参考图上限" : "上传 JPG、PNG 或 WebP 参考图"}</span>
    </button>

    {assets.length ? <ImagePreviewGallery images={assets.map((asset) => ({ id: asset.id, src: asset.preview, alt: asset.name }))}>{({ openPreview }) => <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{assets.map((asset, index) => {
      const role = referenceRoles[index];
      return <div key={asset.id} className="relative aspect-square min-w-0 overflow-hidden rounded-lg border">
        <ImagePreviewTrigger image={{ id: asset.id, src: asset.preview, alt: asset.name }} onOpen={() => openPreview(index)} sizes="120px" />
        <Button type="button" variant="destructive" size="icon-xs" className="absolute right-1 top-1 opacity-90" onClick={() => void onDelete(asset)} aria-label={`删除参考图 ${asset.name}`}><Trash2 /></Button>
        <div className="pointer-events-none absolute inset-x-1 bottom-1 min-w-0 rounded-md bg-background/90 px-1.5 py-1 shadow-sm">
          <p className="break-words text-[10px] font-semibold leading-3">{role.type}</p>
          <p className="mt-0.5 break-words text-[10px] leading-3 text-muted-foreground">{role.detail}</p>
        </div>
      </div>;
    })}</div>}</ImagePreviewGallery> : <p className="mt-3 rounded-lg bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">第一张会作为 Primary Reference。</p>}
  </section>;
}

export function GeneratedImagesPanel({
  assets,
  selectedAssetIds,
  onToggle,
  onDelete,
}: {
  assets: WorkspaceImageAsset[];
  selectedAssetIds: string[];
  onToggle: (assetId: string) => Promise<void>;
  onDelete: (asset: WorkspaceImageAsset) => Promise<void>;
}) {
  return <section aria-labelledby="generated-images-title" className="min-w-0 rounded-xl border bg-background p-3">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 id="generated-images-title" className="text-sm font-semibold">Generated Images（生成结果）</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">AI 生成图会自动保存，可单独选择是否用于发布。</p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">{assets.length} 张 · 已选 {selectedAssetIds.length} 张</span>
    </div>

    {assets.length ? <ImagePreviewGallery images={assets.map((asset) => ({ id: asset.id, src: asset.preview, alt: asset.name }))}>{({ openPreview }) => <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{assets.map((asset, index) => {
      const selected = selectedAssetIds.includes(asset.id);
      return <div key={asset.id} className={cn("group/image relative aspect-square min-w-0 overflow-hidden rounded-lg border", selected && "border-primary/50 ring-1 ring-primary/20")}>
        <ImagePreviewTrigger image={{ id: asset.id, src: asset.preview, alt: asset.name }} onOpen={() => openPreview(index)} sizes="120px" imageClassName={selected ? undefined : "opacity-55"} />
        <Button type="button" variant="destructive" size="icon-xs" className="absolute right-1 top-1 opacity-90 transition-opacity sm:opacity-0 sm:group-hover/image:opacity-90 sm:group-focus-within/image:opacity-90" onClick={() => void onDelete(asset)} aria-label={`删除生成图 ${asset.name}`}><Trash2 /></Button>
        <button type="button" aria-pressed={selected} onClick={() => void onToggle(asset.id)} className="absolute inset-x-1 bottom-1 flex min-h-9 items-center justify-center gap-1 rounded-md bg-background/90 px-1 py-1 text-[11px] font-medium shadow-sm transition-opacity sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100">
          <CheckCircle2 className="size-3" />{selected ? "已选作发布图" : "选作发布图"}
        </button>
      </div>;
    })}</div>}</ImagePreviewGallery> : <div className="mt-3 flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/15 px-3 text-center text-xs text-muted-foreground"><ImageIcon className="size-5" /><span>生成完成后，结果会单独显示在这里。</span></div>}
  </section>;
}
