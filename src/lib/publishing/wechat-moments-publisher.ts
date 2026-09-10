import "server-only";
import type { PublishingCapability, PublishingProvider } from "@/lib/publishing/provider";

export class WechatMomentsPublisher implements PublishingProvider {
  readonly platform = "wechat_moments" as const;
  readonly id = "wechat-moments-manual";
  readonly displayName = "微信朋友圈人工发布";

  async getCapability(): Promise<PublishingCapability> {
    return {
      platform: this.platform,
      mode: "manual_handoff",
      connected: false,
      canPublish: false,
      reason: "需要下载图片并复制文案后，在微信中人工确认发布。",
    };
  }

  async publish() {
    return {
      status: "manual_required" as const,
      code: "manual_handoff_required",
      manualConfirmationRequired: true as const,
    };
  }
}
