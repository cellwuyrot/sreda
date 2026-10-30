"use client";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
export const SYSTEM_SECTIONS = [
  ["monitor", "Мониторинг проектов"],
  ["tz-id", "TZ ID"],
  ["ai", "ИИ-ассистент"],
  ["restrictions", "Настройки ограничений"],
  ["logs", "Логи редактора"],
  ["services", "Услуги"],
  ["vpn", "Надёжное соединение"],
  ["games", "Игры"],
  ["builds", "Сборки"],
  ["servers", "Серверы"],
  ["mail", "Email и обработка данных"],
] as const;
export function systemSection(path: string) {
  return SYSTEM_SECTIONS.find(
    ([key]) => path === `/admin/${key}` || path.startsWith(`/admin/${key}/`),
  );
}
/** Shared visual shell only. Each page keeps its existing role checks, forms and actions. */
export default function AdminSystemShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = useSession();
  const editor = session?.user?.role === "EDITOR";
  const sections = editor
    ? SYSTEM_SECTIONS.filter(([key]) =>
        ["ai", "logs", "services"].includes(key),
      )
    : SYSTEM_SECTIONS;
  const path = usePathname() || "",
    router = useRouter(),
    section = systemSection(path);
  if (!section) return <>{children}</>;
  return (
    <div className="system-admin">
      <div className="system-admin-nav">
        <div className="flex min-w-0 items-center gap-3">
          <span className="system-admin-mark" aria-hidden="true">
            TZ
          </span>
          <div>
            <Link
              href={editor ? "/editor" : "/admin"}
              className="system-admin-back"
            >
              {editor ? "← Редакторская" : "← Администрирование"}
            </Link>
            <p>Сервисы и система</p>
          </div>
        </div>
        <label className="system-admin-section">
          <span className="sr-only">Раздел системы</span>
          <select
            aria-label="Раздел системы"
            value={section[0]}
            onChange={(e) => router.push(`/admin/${e.target.value}`)}
          >
            {sections.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="system-admin-content">{children}</div>
    </div>
  );
}
