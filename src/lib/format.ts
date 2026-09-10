export function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export const publishStatusLabels: Record<string, string> = {
  draft: "草稿",
  ready: "待发布",
  queued: "排队中",
  publishing: "发布中",
  published: "已发布",
  failed: "发布失败",
  manual_required: "需要人工确认",
  connection_required: "需要连接账号",
};
