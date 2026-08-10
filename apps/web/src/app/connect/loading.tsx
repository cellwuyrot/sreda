import Spinner from "@/components/ui/Spinner";

export default function ConnectLoading() {
  return (
    <div className="min-h-screen flex bg-neutral-50 dark:bg-neutral-950">
      {/* Group sidebar skeleton */}
      <div className="w-[72px] bg-neutral-100 dark:bg-neutral-950 border-r border-neutral-200 dark:border-white/5 flex flex-col items-center py-3 gap-2 max-md:hidden">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="w-12 h-12 rounded-2xl bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
        ))}
      </div>
      {/* Channel sidebar skeleton */}
      <div className="w-60 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-white/5 flex flex-col max-md:hidden">
        <div className="p-3 border-b border-neutral-200 dark:border-white/5">
          <div className="h-4 w-32 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse" />
        </div>
        <div className="p-2 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 bg-neutral-100 dark:bg-neutral-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
      {/* Main area skeleton */}
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    </div>
  );
}
