export default function LibraryLoading() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="h-10 w-48 bg-neutral-200 dark:bg-neutral-800 rounded-lg animate-pulse mx-auto mb-4" />
          <div className="h-4 w-72 bg-neutral-200 dark:bg-neutral-800 rounded animate-pulse mx-auto" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6 animate-pulse">
              <div className="h-5 w-2/3 bg-neutral-200 dark:bg-neutral-700 rounded mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded" />
                <div className="h-3 w-4/5 bg-neutral-200 dark:bg-neutral-700 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
