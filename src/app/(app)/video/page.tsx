import { PageHeader } from "@/components/page-header";
import { VideoStudio } from "@/components/video/video-studio";
import { hasDashscopeApiKey, hasProviderEncryptionKey } from "@/lib/env";
import { hasReusableArkKey, listProviderConfigs } from "@/lib/providers/repository";
import { getCurrentUser } from "@/lib/supabase/server";
import { isVideoProviderName, pickProviderByPriority } from "@/lib/video/playback";
import { ALIBABA_WAN_MODEL, RUNWAY_DEFAULT_MODEL, VOLCENGINE_MODEL } from "@/lib/video/provider";
import { MAX_REFERENCE_IMAGES } from "@/lib/video/types";

export default async function VideoPage() {
  const user = await getCurrentUser();
  const configs = user && hasProviderEncryptionKey() ? await listProviderConfigs(user.id).catch(() => []) : [];
  const enabled = (provider: string) => configs.find((item) => item.category === "video" && item.provider === provider && item.enabled);
  const runway = enabled("runway");
  // 阿里云百炼是否启用与「服务端是否配了密钥」是两件事：分开跟踪，
  // 这样启用但缺密钥时能给出准确提示，而不是笼统地说「未配置」。
  const alibabaConfig = enabled("alibaba");
  const wanKeyMissing = Boolean(alibabaConfig) && !hasDashscopeApiKey();
  // 优先级与后端 getVideoProviderConfig 共用同一个 helper：页面显示的 Provider
  // 必须和真正创建任务的 Provider 一致，否则设置页启用一个、页面却显示另一个。
  // 缺密钥的百炼必须先排除，否则页面会显示一个注定提交失败的 Provider。
  const selectable = configs.filter((item) => !(item.provider === "alibaba" && wanKeyMissing));
  const active = pickProviderByPriority(selectable, "video");
  const provider = active && isVideoProviderName(active.provider) ? active.provider : null;
  // provider 为 null 但设置了 wanKeyMissing 时，也要让文案走「阿里云 Wan」那一支。
  const shownProvider = provider ?? (wanKeyMissing ? "alibaba" : null);
  const arkKeyReusable = provider ? false : user ? await hasReusableArkKey(user.id).catch(() => false) : false;
  return (
    <>
      <PageHeader title="AI视频" description={`用商品参考图生成可轮询、可恢复的视频任务（最多 ${MAX_REFERENCE_IMAGES} 张参考图）`} />
      <VideoStudio
        configured={Boolean(active)}
        arkKeyReusable={arkKeyReusable}
        wanKeyMissing={wanKeyMissing}
        provider={shownProvider}
        model={active?.provider === "alibaba" ? active.model || ALIBABA_WAN_MODEL : active?.model ?? VOLCENGINE_MODEL}
        runwayModel={runway?.model ?? RUNWAY_DEFAULT_MODEL}
      />
    </>
  );
}
