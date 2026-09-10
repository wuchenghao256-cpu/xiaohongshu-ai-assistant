import "server-only";
import type { ConnectedAccountContext, PublishingCapability, PublishingProvider } from "@/lib/publishing/provider";

export class DouyinPublisher implements PublishingProvider {
  readonly platform = "douyin" as const;
  readonly id = "douyin-official-api";
  readonly displayName = "抖音官方 API";

  async getCapability(account?: ConnectedAccountContext): Promise<PublishingCapability> {
    const clientConfigured = Boolean(process.env.DOUYIN_CLIENT_KEY && process.env.DOUYIN_CLIENT_SECRET);
    const connected = clientConfigured && account?.status === "connected";
    return {
      platform: this.platform,
      mode: "official_api",
      connected,
      canPublish: false,
      reason: !clientConfigured
        ? "尚未配置抖音开放平台 Client Key。"
        : !connected
          ? "需要通过抖音官方 OAuth 连接账号。"
          : "账号已连接，官方发布接口将在获得权限后接入。",
    };
  }

  async publish(_content: Parameters<PublishingProvider["publish"]>[0], account?: ConnectedAccountContext) {
    const capability = await this.getCapability(account);
    if (capability.connected) {
      return {
        status: "failed" as const,
        code: "official_publish_not_implemented",
        manualConfirmationRequired: false as const,
        errorMessage: "账号已连接，但抖音官方发布接口尚未接入。",
      };
    }
    return {
      status: "connection_required" as const,
      code: "official_api_not_connected",
      manualConfirmationRequired: false as const,
      errorMessage: "抖音官方发布能力尚未配置完成。",
    };
  }
}
