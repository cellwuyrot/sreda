"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Error Boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="text-center max-w-md">
        <div className="text-6xl mb-4">{"⚠️"}</div>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Что-то пошло не так</h2>
        <p className="text-neutral-500 dark:text-gray-400 text-sm mb-6">
          Произошла непредвиденная ошибка. Попробуйте обновить страницу.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2.5 bg-violet-600 dark:bg-cyan-600 text-white rounded-xl hover:bg-violet-500 dark:hover:bg-cyan-500 transition-colors text-sm font-medium"
        >
          Попробовать снова
        </button>
      </div>
    </div>
  );
}
