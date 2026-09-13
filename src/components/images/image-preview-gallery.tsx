"use client";

import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import Image from "next/image";
import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type PreviewImage = {
  id: string;
  src: string;
  alt: string;
};

type GalleryControls = {
  openPreview: (index: number) => void;
};

export function ImagePreviewGallery({
  images,
  children,
}: {
  images: PreviewImage[];
  children: (controls: GalleryControls) => ReactNode;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return <>
    {children({ openPreview: setOpenIndex })}
    <ImagePreviewModal images={images} openIndex={openIndex} onOpenIndexChange={setOpenIndex} />
  </>;
}

export function ImagePreviewTrigger({
  image,
  onOpen,
  className,
  imageClassName,
  sizes = "160px",
}: {
  image: PreviewImage;
  onOpen: () => void;
  className?: string;
  imageClassName?: string;
  sizes?: string;
}) {
  return <button
    type="button"
    onClick={onOpen}
    aria-label={`预览大图：${image.alt}`}
    className={cn("group/preview absolute inset-0 block cursor-zoom-in overflow-hidden text-left", className)}
  >
    <Image unoptimized fill sizes={sizes} src={image.src} alt={image.alt} className={cn("object-cover", imageClassName)} />
    <span className="pointer-events-none absolute left-1 top-1 flex size-7 items-center justify-center rounded-md bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover/preview:opacity-100 group-focus-visible/preview:opacity-100">
      <Expand className="size-3.5" />
    </span>
  </button>;
}

function ImagePreviewModal({
  images,
  openIndex,
  onOpenIndexChange,
}: {
  images: PreviewImage[];
  openIndex: number | null;
  onOpenIndexChange: Dispatch<SetStateAction<number | null>>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const isOpen = openIndex !== null && images.length > 0;
  const currentIndex = isOpen ? Math.min(openIndex, images.length - 1) : 0;
  const currentImage = images[currentIndex];

  const close = useCallback(() => onOpenIndexChange(null), [onOpenIndexChange]);
  const move = useCallback((direction: -1 | 1) => {
    if (images.length < 2) return;
    onOpenIndexChange((index) => index === null ? null : (index + direction + images.length) % images.length);
  }, [images.length, onOpenIndexChange]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [close, isOpen, move]);

  if (!isOpen || !currentImage) return null;

  return <div
    role="dialog"
    aria-modal="true"
    aria-label="图片预览"
    className="fixed inset-0 z-[100] flex min-w-0 flex-col bg-black/90 p-3 text-white sm:p-5"
    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
  >
    <div className="flex shrink-0 items-center justify-between gap-3">
      <span className="rounded-full bg-black/45 px-3 py-1.5 text-sm tabular-nums">{currentIndex + 1} / {images.length}</span>
      <button ref={closeButtonRef} type="button" onClick={close} aria-label="关闭图片预览" className="flex size-10 items-center justify-center rounded-full bg-black/45 transition-colors hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <X className="size-5" />
      </button>
    </div>

    <div
      className="relative my-3 min-h-0 min-w-0 flex-1"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
      onTouchStart={(event) => { touchStartXRef.current = event.changedTouches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        const start = touchStartXRef.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartXRef.current = null;
        if (start === null || end === undefined || Math.abs(end - start) < 45) return;
        move(end < start ? 1 : -1);
      }}
    >
      <Image unoptimized fill priority sizes="100vw" src={currentImage.src} alt={currentImage.alt} className="pointer-events-none select-none object-contain" />
      {images.length > 1 ? <>
        <button type="button" onClick={() => move(-1)} aria-label="上一张图片" className="absolute left-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white sm:left-2">
          <ChevronLeft className="size-6" />
        </button>
        <button type="button" onClick={() => move(1)} aria-label="下一张图片" className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white sm:right-2">
          <ChevronRight className="size-6" />
        </button>
      </> : null}
    </div>

    {images.length > 1 ? <div className="mx-auto flex max-w-full shrink-0 gap-2 overflow-x-auto rounded-xl bg-black/35 p-2">
      {images.map((image, index) => <button key={image.id} type="button" aria-label={`查看第 ${index + 1} 张图片`} aria-current={index === currentIndex ? "true" : undefined} onClick={() => onOpenIndexChange(index)} className={cn("relative size-14 shrink-0 overflow-hidden rounded-lg border-2 border-transparent opacity-65", index === currentIndex && "border-white opacity-100")}>
        <Image unoptimized fill sizes="56px" src={image.src} alt="" className="object-cover" />
      </button>)}
    </div> : null}
  </div>;
}
