import { PageHeader } from "@/components/page-header";
import { VideoStudio } from "@/components/video/video-studio";
import { hasProviderEncryptionKey } from "@/lib/env";
import { hasReusableArkKey, listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { RUNWAY_DEFAULT_MODEL, VOLCENGINE_MODEL } from "@/lib/video/provider";
import { MAX_REFERENCE_IMAGES } from "@/lib/video/types";

export default async function VideoPage() {
  const user = await getCurrentUser();
  const configs = user && hasProviderEncryptionKey() ? await listProviderConfigs(user.id).catch(() => []) : [];
  // 默认 Provider 是豆包 Seedance 2.0；Runway 保留但默认关闭。
  const ark = configs.find((item) => item.category === "video" && item.provider === "volcengine" && item.enabled);
  const runway = configs.find((item) => item.category === "video" && item.provider === "runway" && item.enabled);
  const active = ark ?? runway;
  const arkKeyReusable = ark ? false : user ? await hasReusableArkKey(user.id).catch(() => false) : false;
  return (
    <>
      <PageHeader title="AI视频" description={`用商品参考图生成可轮询、可恢复的视频任务（最多 ${MAX_REFERENCE_IMAGES} 张参考图）`} />
      <VideoStudio
        configured={Boolean(active)}
        arkKeyReusable={arkKeyReusable}
        provider={active?.provider === "volcengine" ? "volcengine" : active ? "runway" : null}
        model={active?.model ?? VOLCENGINE_MODEL}
        runwayModel={runway?.model ?? RUNWAY_DEFAULT_MODEL}
      />
    </>
  );
}
