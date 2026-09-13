import { Skeleton } from "@/components/ui/skeleton";

/** 系统设置：左侧分区导航 + 右侧卡片列表。 */
export default function SettingsLoading() {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b bg-background px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-8 p-4 sm:p-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex gap-1 overflow-x-auto lg:flex-col">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-32 shrink-0 rounded-lg" />
          ))}
        </div>
        <div className="flex flex-col gap-6">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
