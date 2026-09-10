export const platforms = ["xiaohongshu", "douyin", "weibo", "wechat_moments"] as const;
export type Platform = (typeof platforms)[number];

export const publishingModes = ["official_api", "manual_handoff", "unavailable"] as const;
export type PublishingMode = (typeof publishingModes)[number];

export const publishingStatuses = [
  "draft",
  "ready",
  "queued",
  "publishing",
  "published",
  "failed",
  "manual_required",
  "connection_required",
] as const;
export type PublishingStatus = (typeof publishingStatuses)[number];

export type ConnectedAccountContext = {
  id: string;
  status: "connected" | "expired" | "revoked" | "error";
  expiresAt: string | null;
};

export type PublishingCapability = {
  platform: Platform;
  mode: PublishingMode;
  connected: boolean;
  canPublish: boolean;
  reason: string;
};

export type PublishContent = {
  postId: string;
  title: string;
  body: string;
  hashtags: string[];
  imageUrls: string[];
  platformVariant?: {
    title?: string | null;
    body?: string | null;
    hashtags?: string[];
    payload?: Record<string, unknown>;
  };
};

export type PublishingResult = {
  status: Extract<PublishingStatus, "published" | "failed" | "manual_required" | "connection_required">;
  code: string;
  manualConfirmationRequired: boolean;
  externalPostId?: string;
  errorMessage?: string;
};

export interface PublishingProvider {
  readonly platform: Platform;
  readonly id: string;
  readonly displayName: string;
  getCapability(account?: ConnectedAccountContext): Promise<PublishingCapability>;
  connect?(): Promise<void>;
  publish(content: PublishContent, account?: ConnectedAccountContext): Promise<PublishingResult>;
}
