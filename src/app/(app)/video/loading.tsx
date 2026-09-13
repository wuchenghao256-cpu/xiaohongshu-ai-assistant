import { Skeleton } from "@/components/ui/skeleton";

/** 与视频页同形：模式选择卡片 + 参数表单 + 任务列表。 */
export default function VideoLoading() {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b bg-background px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-5 p-4 sm:p-8">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
