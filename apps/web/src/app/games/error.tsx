"use client";

import { useEffect } from "react";

export default function GamesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Games Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">{"\uD83C\uDFAE"}</div>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Ошибка в игровом модуле</h2>
        <p className="text-neutral-500 dark:text-gray-400 text-sm mb-6">
          Произошла ошибка при загрузке игры.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-500 transition-colors text-sm font-medium"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}
