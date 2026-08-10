/* GAMES-CATALOG: скелет под новую тёмную витрину. Прежний был светлым, и на
   переходе давал вспышку белым перед тёмной страницей. */
export default function GamesLoading() {
  return (
    <div className="min-h-screen bg-[#0a0a0d] px-5 py-14 max-md:px-4 max-md:py-8">
      <div className="mx-auto max-w-6xl animate-pulse">
        <div className="h-3 w-24 rounded bg-white/[0.07]" />
        <div className="mt-3 h-12 w-40 rounded-lg bg-white/[0.09]" />
        <div className="mt-4 h-3 w-80 max-w-full rounded bg-white/[0.06]" />
        <div className="mt-10 h-[420px] rounded-3xl bg-white/[0.05] max-md:h-[300px]" />
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-white/10">
              <div className="h-44 bg-white/[0.05]" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 rounded bg-white/[0.07]" />
                <div className="h-3 w-1/2 rounded bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
