import Link from "next/link";
import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import {
  XiaohongshuPublishAssistant,
  type AssistantCopy,
  type AssistantCover,
  type AssistantVideo,
} from "@/components/publishing/xiaohongshu-publish-assistant";
import { Button } from "@/components/ui/button";
import { getSupabasePublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** 每条素材最多签出这么多张封面候选，避免一次渲染几十个 Storage 签名。 */
const MAX_COVERS_PER_SOURCE = 6;
const MAX_VIDEOS = 24;
const MAX_COPIES = 24;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 视频任务的参考图存在 `input_snapshot.inputPaths` 里（product-assets 私有 bucket）。
 * 用第一张当默认封面：那正是视频的首帧，也是小红书最常见的封面选择。
 */
type CoverCandidate = { id: string; url: string; label: string; source: "video" | "copy" };

async function signCoverPaths(supabase: Supabase, paths: unknown, prefix: string): Promise<AssistantCover[]> {
  if (!Array.isArray(paths)) return [];
  const valid = paths
    .filter((path): path is string => typeof path === "string" && path.length > 0)
    .slice(0, MAX_COVERS_PER_SOURCE);
  const signed = await Promise.all(valid.map(async (path, index): Promise<CoverCandidate | null> => {
    const url = await supabase.storage.from("product-assets").createSignedUrl(path, 3600);
    if (url.error || !url.data?.signedUrl) return null;
    return { id: `${prefix}-${path}`, url: url.data.signedUrl, label: index === 0 ? "视频首帧" : `参考图 ${index + 1}`, source: "video" };
  }));
  return signed.filter((item): item is CoverCandidate => item !== null);
}

export default async function XiaohongshuAssistantPage() {
  const configured = Boolean(getSupabasePublicEnv());
  const videos: AssistantVideo[] = [];
  const copies: AssistantCopy[] = [];
  const coversByVideo: Record<string, AssistantCover[]> = {};
  const coversByCopy: Record<string, AssistantCover[]> = {};

  if (configured) {
    const supabase = await createClient();
    const [jobsResult, postsResult, draftsResult] = await Promise.all([
      // 只有已完成的任务才有可下载的视频。
      supabase
        .from("video_jobs")
        .select("id,kind,output_url,input_snapshot,created_at")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(MAX_VIDEOS),
      supabase
        .from("posts")
        .select("id,title,body,hashtags,updated_at")
        .eq("status", "final")
        .order("updated_at", { ascending: false })
        .limit(MAX_COPIES),
      supabase
        .from("content_drafts")
        .select("id,title,body,hashtags,generated_asset_id,updated_at")
        .order("updated_at", { ascending: false })
        .limit(MAX_COPIES),
    ]);

    const completed = jobsResult.data ?? [];
    // 与 /api/video-jobs 的 GET 用同一条判据：只有 video_assets 里有记录才算「可长期下载」的
    // 视频。还没转存的任务，其 output_url 是 24 小时后必定过期的临时地址。
    const persisted = completed.length
      ? await supabase.from("video_assets").select("video_job_id").in("video_job_id", completed.map((job) => job.id))
      : { data: [], error: null };
    const savedIds = new Set((persisted.data ?? []).map((row) => row.video_job_id));

    for (const job of completed) {
      if (!savedIds.has(job.id)) continue;
      videos.push({
        id: job.id,
        // 下载与播放都走同源接口，因此这里不需要（也不该）下发签名地址。
        playbackUrl: `/api/video-jobs/${job.id}/download`,
        createdAt: job.created_at,
        label: new Date(job.created_at).toLocaleString("zh-CN"),
      });
      const snapshot = job.input_snapshot as { inputPaths?: unknown } | null;
      const covers = await signCoverPaths(supabase, snapshot?.inputPaths, job.id);
      if (covers.length) coversByVideo[job.id] = covers;
    }

    for (const post of postsResult.data ?? []) {
      copies.push({ id: post.id, title: post.title, body: post.body, hashtags: post.hashtags, origin: "final" });
    }
    for (const draft of draftsResult.data ?? []) {
      copies.push({ id: draft.id, title: draft.title, body: draft.body, hashtags: draft.hashtags, origin: "draft" });
    }

    // 草稿的成图可以直接当封面：它本来就是为这条文案生成的配图。
    // 这里只按 id 取一次，签名统一放在下面批量做，避免每条草稿各发一次请求。
    const assetIds = [...new Set((draftsResult.data ?? []).map((draft) => draft.generated_asset_id).filter((id): id is string => Boolean(id)))];
    if (assetIds.length) {
      const assets = await supabase.from("assets").select("id,storage_bucket,storage_path,original_name").in("id", assetIds);
      const byAsset = new Map((assets.data ?? []).map((asset) => [asset.id, asset]));
      await Promise.all((draftsResult.data ?? []).map(async (draft) => {
        const asset = draft.generated_asset_id ? byAsset.get(draft.generated_asset_id) : undefined;
        if (!asset) return;
        const url = await supabase.storage.from(asset.storage_bucket).createSignedUrl(asset.storage_path, 3600);
        if (url.error || !url.data?.signedUrl) return;
        coversByCopy[draft.id] = [{ id: `${draft.id}-${asset.id}`, url: url.data.signedUrl, label: "该文案的配图", source: "copy" as const }];
      }));
    }
  }

  return <>
    <PageHeader
      title="小红书发布助手"
      description="选择一条视频和一条文案，一键准备发布：复制文案并打开系统分享面板"
      actions={<Button nativeButton={false} variant="outline" render={<Link href="/publishing" />}>返回发布中心</Button>}
    />
    {!configured ? <div className="px-4 pt-4 sm:px-8 sm:pt-8"><ConfigurationAlert /></div> : null}
    <XiaohongshuPublishAssistant
      videos={videos}
      copies={copies}
      coversByVideo={coversByVideo}
      coversByCopy={coversByCopy}
    />
  </>;
}
