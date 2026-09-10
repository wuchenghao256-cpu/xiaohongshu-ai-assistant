import "server-only";
import { DouyinPublisher } from "@/lib/publishing/douyin-publisher";
import type { Platform, PublishingProvider } from "@/lib/publishing/provider";
import { WechatMomentsPublisher } from "@/lib/publishing/wechat-moments-publisher";
import { WeiboPublisher } from "@/lib/publishing/weibo-publisher";
import { XiaohongshuPublisher } from "@/lib/publishing/xiaohongshu-publisher";

const providers: Record<Platform, PublishingProvider> = {
  xiaohongshu: new XiaohongshuPublisher(),
  douyin: new DouyinPublisher(),
  weibo: new WeiboPublisher(),
  wechat_moments: new WechatMomentsPublisher(),
};

export function getPublishingProvider(platform: Platform) {
  return providers[platform];
}

export function getPublishingProviders() {
  return Object.values(providers);
}
