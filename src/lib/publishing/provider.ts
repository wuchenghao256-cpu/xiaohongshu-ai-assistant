export const publishingStatuses = ["draft", "ready", "publishing", "published", "failed"] as const;
export type PublishingStatus = (typeof publishingStatuses)[number];

export type PublishingPayload = {
  postId: string;
  title: string;
  body: string;
  hashtags: string[];
  imageUrls: string[];
};

export type PublishingResult = {
  status: "ready";
  code: "official_publishing_unavailable";
  manualConfirmationRequired: true;
};

export interface PublishingProvider {
  readonly id: string;
  readonly displayName: string;
  readonly supportsDirectPublish: boolean;
  publishPost(payload: PublishingPayload): Promise<PublishingResult>;
}
