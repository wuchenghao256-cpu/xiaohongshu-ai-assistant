import { Skeleton } from "@/components/ui/skeleton";

/** 与素材库卡片网格同形：2 / 3 / 4 列，正方形缩略图 + 两行说明。 */
export default function AssetsLoading() {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b bg-background px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="p-4 sm:p-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {[64, 96, 96].map((width) => (
              <Skeleton key={width} className="h-7 rounded-lg" style={{ width }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
              >
                <Skeleton className="aspect-square rounded-none" />
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
