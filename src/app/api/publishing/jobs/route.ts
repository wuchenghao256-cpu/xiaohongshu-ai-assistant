import { z } from "zod";
import { jsonError } from "@/lib/http";
import { platforms, type ConnectedAccountContext, type Platform } from "@/lib/publishing/provider";
import { getPublishingProvider } from "@/lib/publishing/registry";
import { requireUser } from "@/lib/supabase/auth";

const requestSchema = z.object({
  postId: z.string().uuid(),
  platforms: z.array(z.enum(platforms)).min(1).max(platforms.length).refine(
    (items) => new Set(items).size === items.length,
    "发布平台不能重复。",
  ),
});

const platformLabels: Record<Platform, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  weibo: "微博",
  wechat_moments: "微信朋友圈",
};

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const { user, supabase } = await requireUser();
    const postResult = await supabase
      .from("posts")
      .select("id,task_id,title,body,hashtags,status")
      .eq("id", input.postId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (postResult.error) throw postResult.error;
    if (!postResult.data) return Response.json({ error: "内容不存在或无权访问。" }, { status: 404 });
    const post = postResult.data;
    if (post.status !== "final" || !post.title.trim() || !post.body.trim()) {
      return Response.json({ error: "请先选择并保存最终文案。" }, { status: 400 });
    }

    const [assetsResult, accountsResult] = await Promise.all([
      supabase.from("assets").select("storage_path").eq("task_id", post.task_id).eq("user_id", user.id).eq("selected_for_publishing", true).order("created_at"),
      supabase.from("connected_accounts").select("id,platform,status,expires_at").in("platform", input.platforms),
    ]);
    if (assetsResult.error) throw assetsResult.error;
    if (accountsResult.error) throw accountsResult.error;
    if (!assetsResult.data.length) return Response.json({ error: "请至少选择并保存一张待发布图片。" }, { status: 400 });

    const accountMap = new Map<Platform, ConnectedAccountContext>();
    for (const account of accountsResult.data ?? []) {
      const platform = account.platform as Platform;
      if (!accountMap.has(platform)) accountMap.set(platform, {
        id: account.id,
        status: account.status,
        expiresAt: account.expires_at,
      });
    }

    const rows = await Promise.all(input.platforms.map(async (platform) => {
      const provider = getPublishingProvider(platform);
      const account = accountMap.get(platform);
      const result = await provider.publish({
        postId: post.id,
        title: post.title,
        body: post.body,
        hashtags: post.hashtags,
        imageUrls: [],
      }, account);
      return {
        user_id: user.id,
        post_id: post.id,
        account_id: account?.id ?? null,
        platform,
        provider: provider.id,
        status: result.status,
        error_message: result.errorMessage ?? null,
        external_post_id: result.externalPostId ?? null,
        published_at: result.status === "published" ? new Date().toISOString() : null,
      };
    }));

    const inserted = await supabase.from("publishing_jobs").insert(rows).select("id,post_id,platform,provider,status,error_message,created_at");
    if (inserted.error) throw inserted.error;
    if (rows.some((row) => row.status === "manual_required")) {
      const update = await supabase.from("posts").update({ publish_status: "ready" }).eq("id", input.postId).eq("user_id", user.id);
      if (update.error) throw update.error;
    }

    return Response.json({
      jobs: (inserted.data ?? []).map((job) => ({
        id: job.id,
        postId: job.post_id,
        postTitle: post.title,
        platform: job.platform,
        provider: job.provider,
        status: job.status,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        platformLabel: platformLabels[job.platform as Platform],
      })),
    }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
