import "server-only";
import type { PublishingPayload, PublishingProvider } from "@/lib/publishing/provider";

export class XiaohongshuPublisher implements PublishingProvider {
  readonly id = "xiaohongshu-manual";
  readonly displayName = "小红书人工发布";
  readonly supportsDirectPublish = false;

  async publishPost(payload: PublishingPayload) {
    void payload;
    return {
      status: "ready" as const,
      code: "official_publishing_unavailable" as const,
      manualConfirmationRequired: true as const,
    };
  }
}

export function getPublishingProvider(): PublishingProvider {
  return new XiaohongshuPublisher();
}
