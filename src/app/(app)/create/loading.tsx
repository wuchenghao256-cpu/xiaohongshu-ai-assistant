import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/create` 首屏最重（还会查模板与内容会话），但左侧表单是同步渲染的。
 * 这里只做一小段轻量骨架，正常导航时几乎看不到，慢请求时也不会白屏。
 */
export default function CreateLoading() {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b bg-background px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="grid min-h-[calc(100vh-112px)] xl:grid-cols-[minmax(520px,1fr)_minmax(480px,1fr)]">
        <div className="flex flex-col gap-4 border-b bg-background p-4 sm:p-6 xl:border-r xl:border-b-0">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-20 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
        <div className="min-w-0 bg-muted/20 p-4 sm:p-6">
          <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="aspect-square rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
