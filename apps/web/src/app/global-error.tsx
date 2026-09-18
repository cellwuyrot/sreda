"use client";

import { useEffect, useState } from "react";

/** Ошибки корневого layout/Providers не покрываются обычным app/error.tsx.
 * Здесь нельзя использовать провайдеры, шрифты или компоненты основного дерева.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { console.error("[Root Error Boundary]", error); }, [error]);

  const reload = async () => {
    setBusy(true);
    setMessage("");
    try {
      // Не импортируем desktop.ts: аварийная страница должна быть независимой.
      const desktop = (window as unknown as {
        triozDesktop?: { recoverWindow?: () => Promise<boolean> };
      }).triozDesktop;
      if (desktop?.recoverWindow) {
        if (await desktop.recoverWindow()) return;
        setMessage("Воспользуйтесь пунктом «Перезагрузить без кеша» в меню значка приложения.");
        setBusy(false);
        return;
      }
      // Браузер/старый Electron: полная загрузка вместо reset старого дерева.
      window.location.reload();
    } catch {
      setMessage("Не удалось перезагрузить окно. Закройте приложение и запустите снова.");
      setBusy(false);
    }
  };

  return (
    <html lang="ru">
      <body style={{ margin: 0, background: "#0b0d12", color: "#eef1f7", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
          <section style={{ maxWidth: 520 }}>
            <h1 style={{ fontSize: 26 }}>Не удалось открыть TZ.Connect</h1>
            <p style={{ lineHeight: 1.6, color: "#b6bfce" }}>Интерфейс столкнулся с ошибкой. Проверьте подключение и перезагрузите окно. Вход в аккаунт сохранится.</p>
            <button type="button" disabled={busy} onClick={() => void reload()} style={{ padding: "13px 20px", borderRadius: 9, border: 0, background: "#86d7eb", color: "#10212b", font: "inherit", cursor: "pointer" }}>
              {busy ? "Восстанавливаем…" : "Перезагрузить окно"}
            </button>
            <p style={{ fontSize: 13, color: "#929daf" }}>Перезагрузка прервёт звонок и может удалить неотправленный черновик.</p>
            {message && <p role="alert">{message}</p>}
          </section>
        </main>
      </body>
    </html>
  );
}
