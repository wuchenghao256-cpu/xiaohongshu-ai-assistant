import { PageHeader } from "@/components/page-header";
import { VideoStudio } from "@/components/video/video-studio";
import { hasProviderEncryptionKey } from "@/lib/env";
import { listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function VideoPage() {
  const user = await getCurrentUser();
  const configs = user && hasProviderEncryptionKey() ? await listProviderConfigs(user.id).catch(() => []) : [];
  const runway = configs.find((item) => item.category === "video" && item.provider === "runway" && item.enabled);
  return (
    <>
      <PageHeader title="AI视频" description="用商品参考图生成可轮询、可恢复的 Runway 视频任务" />
      <VideoStudio configured={Boolean(runway)} models={{ fast: runway?.model ?? "gen4_turbo", quality: runway?.qualityModel ?? "gen4.5" }} />
    </>
  );
}
