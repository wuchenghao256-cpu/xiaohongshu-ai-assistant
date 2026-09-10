import { ConfigurationAlert } from "@/components/configuration-alert";
import { PageHeader } from "@/components/page-header";
import {
  PublishingCenter,
  type PlatformCapabilityView,
  type PublishingJobView,
  type PublishingPost,
} from "@/components/publishing/publishing-center";
import { getSupabasePublicEnv } from "@/lib/env";
import type { ConnectedAccountContext, Platform } from "@/lib/publishing/provider";
import { getPublishingProviders } from "@/lib/publishing/registry";
import { createClient } from "@/lib/supabase/server";

const platformLabels: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  weibo: "微博",
  wechat_moments: "微信朋友圈",
};

export default async function PublishingPage() {
  const configured = Boolean(getSupabasePublicEnv());
  let posts: PublishingPost[] = [];
  let jobs: PublishingJobView[] = [];
  const accountMap = new Map<Platform, ConnectedAccountContext>();

  if (configured) {
    const supabase = await createClient();
    const [postsResult, accountsResult, jobsResult] = await Promise.all([
      supabase.from("posts").select("id,task_id,title,body,hashtags").eq("status", "final").order("updated_at", { ascending: false }),
      supabase.from("connected_accounts").select("id,platform,status,expires_at").order("updated_at", { ascending: false }),
      supabase.from("publishing_jobs").select("id,post_id,platform,provider,status,error_message,created_at,posts(title)").order("created_at", { ascending: false }).limit(12),
    ]);

    for (const account of accountsResult.data ?? []) {
      const platform = account.platform as Platform;
      if (!accountMap.has(platform)) accountMap.set(platform, {
        id: account.id,
        status: account.status,
        expiresAt: account.expires_at,
      });
    }

    const taskIds = (postsResult.data ?? []).map((post) => post.task_id);
    const assetCounts = new Map<string, number>();
    if (taskIds.length) {
      const assetsResult = await supabase.from("assets").select("task_id").in("task_id", taskIds).eq("selected_for_publishing", true);
      for (const asset of assetsResult.data ?? []) assetCounts.set(asset.task_id, (assetCounts.get(asset.task_id) ?? 0) + 1);
    }
    posts = (postsResult.data ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      body: post.body,
      hashtags: post.hashtags,
      selectedImageCount: assetCounts.get(post.task_id) ?? 0,
    }));

    jobs = (jobsResult.data ?? []).map((job) => ({
      id: job.id,
      postId: job.post_id,
      postTitle: Array.isArray(job.posts) ? job.posts[0]?.title ?? "已删除内容" : (job.posts as { title?: string } | null)?.title ?? "已删除内容",
      platform: job.platform as Platform,
      provider: job.provider,
      status: job.status,
      errorMessage: job.error_message,
      createdAt: job.created_at,
    }));
  }

  const capabilities: PlatformCapabilityView[] = await Promise.all(getPublishingProviders().map(async (provider) => {
    const capability = await provider.getCapability(accountMap.get(provider.platform));
    return {
      ...capability,
      label: platformLabels[provider.platform],
      actionLabel: capability.mode === "manual_handoff" ? "准备发布" : capability.connected ? "接口待接入" : "连接账号",
    };
  }));

  return <>
    <PageHeader title="发布中心" description="选择一条最终内容，为每个平台分别创建发布任务" />
    {!configured ? <div className="px-4 pt-4 sm:px-8 sm:pt-8"><ConfigurationAlert /></div> : null}
    <PublishingCenter initialPosts={posts} capabilities={capabilities} initialJobs={jobs} />
  </>;
}
