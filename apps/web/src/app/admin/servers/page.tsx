"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";
import InfoTooltip from "@/components/ui/InfoTooltip";

/**
 * SERVER-MESH: связка главного сервера с дочерними узлами.
 *
 * Главный сервер — тот, где работает это приложение (запись с ролью MAIN, она
 * одна). Дочерние узлы — отдельные машины.
 *
 * ── Что связка делает НА САМОМ ДЕЛЕ ────────────────────────────────────────
 *
 * На работу влияют ДВА назначения:
 *
 *   • VPN — по нему выбирается узел для нового доступа и ему уходит список пиров;
 *   • Хранилище — на настроенный узел уезжают загруженные файлы (STORAGE-PRIORITY).
 *     Пока такого узла нет, всё лежит на диске главного сервера, как и раньше;
 *     как только он появился, новые файлы идут на него, а накопленные
 *     переносятся по кнопке.
 *
 * «Медиа» и «Вычисления» остаются пометками для учёта — на пути файлов они не
 * влияют, и интерфейс об этом говорит прямо.
 *
 * Узел не подключается к базе: он раз в минуту отправляет отчёт на
 * `POST /api/servers/report` с токеном агента и получает в ответ адрес главного
 * сервера. Отсюда и «связка»: узел знает, кому подчиняется, а панель видит,
 * что он на связи.
 *
 * Токен агента показывается РОВНО ОДИН РАЗ — при создании узла или
 * перевыпуске. В базе лежит только его SHA-256, поэтому подсмотреть токен
 * позже нельзя даже администратору: потерянный токен только перевыпускается.
 */

/* VPN-TRANSPORT: подписи для администратора. Протокол намеренно не назван —
   в интерфейсе есть только «что это даёт», а не «как называется». */
const TRANSPORT_OPTIONS: { value: string; label: string }[] = [
  { value: "PLAIN", label: "Обычное подключение" },
  { value: "OBFUSCATED", label: "Устойчивое к блокировкам" },
];

const KINDS: { value: string; label: string }[] = [
  { value: "APP", label: "Приложение" },
  { value: "MEDIA", label: "Медиа" },
  { value: "VPN", label: "Соединение" },
  { value: "COMPUTE", label: "Вычисления" },
  { value: "STORAGE", label: "Хранилище" },
  /* BUILDS: агент сборки приложений. Обычно живёт на главном сервере, но запись
     всё равно дочерняя — она описывает агента, а не машину. */
  { value: "BUILD", label: "Сборка" },
];

interface Node {
  id: string;
  name: string;
  role: string;
  kind: string;
  url: string;
  endpointHost: string;
  transport: string;
  hasObfuscation: boolean;
  region: string;
  publicIps: string;
  storageEndpoint: string;
  storageBucket: string;
  storageRegion: string;
  storageKeyId: string;
  hasStorageSecret: boolean;
  hasToken: boolean;
  lastSeenAt: string | null;
  status: "online" | "offline" | "disabled";
  enabled: boolean;
  note: string;
  report: Record<string, string | number> | null;
}

/** STORAGE-PRIORITY: картина по файлам из /api/admin/storage. */
interface StorageStats {
  total: number;
  onMain: number;
  byNode: { nodeId: string; name: string; count: number }[];
  target: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<Node["status"], string> = {
  online: "На связи",
  offline: "Нет отчёта",
  disabled: "Отключён",
};

const STATUS_CLASS: Record<Node["status"], string> = {
  online: "bg-green-500/15 text-green-600 dark:text-green-400",
  offline: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  disabled: "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "отчётов не было";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "только что";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} дн назад`;
}

export default function AdminServersPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Токен, выданный только что: живёт до перезагрузки списка. */
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);
  const [form, setForm] = useState({ name: "", role: "CHILD", kind: "APP", url: "", endpointHost: "", transport: "PLAIN", region: "", note: "" });
  const [creating, setCreating] = useState(false);
  /* STORAGE-PRIORITY: сколько файлов где лежит и куда пойдут новые. */
  const [files, setFiles] = useState<StorageStats | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/servers");
      if (!res.ok) throw new Error("Не удалось загрузить список серверов");
      const data = await res.json();
      setNodes(Array.isArray(data?.nodes) ? data.nodes : []);
      setError("");
      /* Картина по файлам грузится отдельно и молча: это справка, и её
         недоступность не должна мешать управлять узлами. */
      try {
        const stats = await fetch("/api/admin/storage");
        setFiles(stats.ok ? await stats.json() : null);
      } catch {
        setFiles(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.role === "ADMIN") void load();
  }, [session, load]);

  const create = async () => {
    if (!form.name.trim()) { setError("Укажите название узла"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось добавить узел"); return; }
      setError("");
      if (data?.token) setFreshToken({ name: form.name.trim(), token: data.token });
      setForm({ name: "", role: "CHILD", kind: "APP", url: "", endpointHost: "", transport: "PLAIN", region: "", note: "" });
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>, nodeName?: string) => {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось сохранить"); return; }
      setError("");
      if (data?.token) setFreshToken({ name: nodeName || "узел", token: data.token });
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * STORAGE-PRIORITY: перенести порцию накопленного на узел или вернуть порцию
   * файлов узла на главный сервер. Порциями и по нажатию — чтобы было видно,
   * сколько осталось, и чтобы можно было остановиться.
   */
  const moveFiles = async (body: Record<string, unknown>) => {
    setMoving(true);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось перенести файлы"); return; }
      setError("");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setMoving(false);
    }
  };

  const remove = async (node: Node) => {
    if (!window.confirm(`Удалить узел «${node.name}»? Его агент потеряет связь.`)) return;
    setBusyId(node.id);
    try {
      const res = await fetch(`/api/admin/servers?id=${encodeURIComponent(node.id)}`, { method: "DELETE" });
      if (!res.ok) { setError("Не удалось удалить узел"); return; }
      setError("");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusyId(null);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  const main = nodes.find((n) => n.role === "MAIN") ?? null;
  const children = nodes.filter((n) => n.role !== "MAIN");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">← Назад</Link>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">
            Серверы{" "}
            <InfoTooltip
              side="bottom"
              text="Главный сервер — тот, на котором крутится это приложение. Дочерние узлы раз в минуту сами отчитываются о себе по токену агента и в ответ получают адрес главного. К базе данных дочерний узел не ходит вообще."
            />
          </h1>
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

        {freshToken && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/[0.07] p-4">
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-300">
              Токен агента для «{freshToken.name}»
            </p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-gray-300">
              Скопируйте его сейчас — он показывается один раз. В базе хранится только хеш,
              поэтому посмотреть токен позже не сможет никто, включая администратора.
            </p>
            <code className="mt-2 block break-all rounded-lg bg-neutral-900 px-3 py-2 text-xs text-green-300">
              {freshToken.token}
            </code>
            <button
              type="button"
              onClick={() => setFreshToken(null)}
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"
            >
              Я скопировал, скрыть
            </button>
          </div>
        )}

        {/* ── Главный сервер ── */}
        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Главный сервер</h2>
          {loading ? (
            <p className="mt-2 text-xs text-neutral-400">Загрузка…</p>
          ) : main ? (
            <div className="mt-2 space-y-1 text-sm">
              <p className="font-medium text-neutral-900 dark:text-white">{main.name}</p>
              <p className="text-xs text-neutral-500 dark:text-gray-400">
                {main.url || "адрес не указан"}{main.region ? ` · ${main.region}` : ""}
              </p>
              <button
                type="button"
                disabled={busyId === main.id}
                onClick={() => remove(main)}
                className="mt-1 text-xs text-red-500 hover:underline disabled:opacity-50"
              >
                Снять роль главного
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-500 dark:text-gray-400">
              Не назначен. Добавьте узел с ролью «Главный» и укажите адрес этого сервера —
              дочерние узлы получат его в ответе на отчёт.
            </p>
          )}
        </section>

        {/* ── Дочерние узлы ── */}
        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Дочерние узлы {children.length > 0 && <span className="text-neutral-400">· {children.length}</span>}
          </h2>
          {loading ? (
            <p className="mt-2 text-xs text-neutral-400">Загрузка…</p>
          ) : children.length === 0 ? (
            <p className="mt-2 text-xs text-neutral-500 dark:text-gray-400">Узлов пока нет.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {children.map((node) => (
                <div key={node.id} className="rounded-lg border border-neutral-200 dark:border-white/10 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-white">{node.name}</span>
                    <span className="rounded-full bg-neutral-100 dark:bg-white/10 px-2 py-0.5 text-[10px] text-neutral-600 dark:text-gray-300">
                      {KINDS.find((k) => k.value === node.kind)?.label ?? node.kind}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[node.status]}`}>
                      {STATUS_LABEL[node.status]}
                    </span>
                    <span className="ml-auto text-[10px] text-neutral-400">{relativeTime(node.lastSeenAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                    {node.url || "адрес не указан"}{node.region ? ` · ${node.region}` : ""}
                    {!node.hasToken && " · токен не выпущен"}
                  </p>
                  {/* VPN-EXIT: пул внешних адресов имеет смысл только у VPN-узла. */}
                  {node.kind === "VPN" && (
                    <>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                        Точка подключения: {node.endpointHost || "не задана — берётся из отчёта узла"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                        Тип подключения:{" "}
                        {TRANSPORT_OPTIONS.find((t) => t.value === node.transport)?.label ?? node.transport}
                        {node.transport === "OBFUSCATED" && !node.hasObfuscation && (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" "}· узел ещё не сообщил параметры
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                        Внешние адреса: {node.publicIps || "не заданы (общий выход узла)"}
                      </p>
                    </>
                  )}
                  {/* STORAGE-PRIORITY: у узла хранения показываем, готов ли он принимать файлы. */}
                  {node.kind === "STORAGE" && (
                    <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                      Хранилище:{" "}
                      {node.storageEndpoint && node.storageBucket && node.storageKeyId && node.hasStorageSecret ? (
                        <>
                          {node.storageEndpoint} · корзина {node.storageBucket}
                          {files?.target?.id === node.id && (
                            <span className="text-green-600 dark:text-green-400"> · новые файлы идут сюда</span>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          не настроено — файлы остаются на главном сервере
                        </span>
                      )}
                    </p>
                  )}
                  {node.note && <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">{node.note}</p>}
                  {node.report && Object.keys(node.report).length > 0 && (
                    <p className="mt-1 text-[10px] text-neutral-400">
                      {Object.entries(node.report).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <button
                      type="button"
                      disabled={busyId === node.id}
                      onClick={() => patch(node.id, { enabled: !node.enabled })}
                      className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                    >
                      {node.enabled ? "Отключить" : "Включить"}
                    </button>
                    {node.kind === "VPN" && (
                      <button
                        type="button"
                        disabled={busyId === node.id}
                        onClick={() =>
                          void patch(node.id, {
                            transport: node.transport === "OBFUSCATED" ? "PLAIN" : "OBFUSCATED",
                          })
                        }
                        className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                      >
                        {node.transport === "OBFUSCATED" ? "Сделать обычным" : "Сделать устойчивым"}
                      </button>
                    )}
                    {node.kind === "VPN" && (
                      <button
                        type="button"
                        disabled={busyId === node.id}
                        onClick={() => {
                          const next = window.prompt(
                            "Точка подключения: IP или домен, при желании с портом. Пусто — брать из отчёта узла.",
                            node.endpointHost,
                          );
                          if (next === null) return;
                          void patch(node.id, { endpointHost: next });
                        }}
                        className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                      >
                        Точка подключения
                      </button>
                    )}
                    {node.kind === "VPN" && (
                      <button
                        type="button"
                        disabled={busyId === node.id}
                        onClick={() => {
                          const next = window.prompt(
                            "Внешние адреса выхода через запятую. Пусто — общий адрес узла.",
                            node.publicIps,
                          );
                          if (next === null) return;
                          void patch(node.id, { publicIps: next });
                        }}
                        className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                      >
                        Внешние адреса
                      </button>
                    )}
                    {node.kind === "STORAGE" && (
                      <button
                        type="button"
                        disabled={busyId === node.id}
                        onClick={() => {
                          const endpoint = window.prompt(
                            "Адрес хранилища узла, например https://files1.example.ru:9000",
                            node.storageEndpoint,
                          );
                          if (endpoint === null) return;
                          const bucket = window.prompt("Имя корзины", node.storageBucket || "trioz");
                          if (bucket === null) return;
                          const region = window.prompt("Регион подписи", node.storageRegion || "us-east-1");
                          if (region === null) return;
                          void patch(node.id, { storageEndpoint: endpoint, storageBucket: bucket, storageRegion: region });
                        }}
                        className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                      >
                        Адрес хранилища
                      </button>
                    )}
                    {node.kind === "STORAGE" && (
                      <button
                        type="button"
                        disabled={busyId === node.id}
                        onClick={() => {
                          const keyId = window.prompt("Идентификатор ключа доступа", node.storageKeyId);
                          if (keyId === null) return;
                          /* Секрет вводится заново каждый раз: показать прежний
                             невозможно — он хранится зашифрованным, и это
                             намеренно. Пустая строка оставит прежний ключ. */
                          const secret = window.prompt(
                            node.hasStorageSecret
                              ? "Секретный ключ. Пусто — оставить прежний."
                              : "Секретный ключ",
                            "",
                          );
                          if (secret === null) return;
                          void patch(node.id, { storageKeyId: keyId, storageSecret: secret });
                        }}
                        className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                      >
                        Ключ доступа
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === node.id}
                      onClick={() => patch(node.id, { rotateToken: true }, node.name)}
                      className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                    >
                      Перевыпустить токен
                    </button>
                    <button
                      type="button"
                      disabled={busyId === node.id}
                      onClick={() => remove(node)}
                      className="text-red-500 hover:underline disabled:opacity-50"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Файлы: где лежат и перенос ── */}
        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Файлы{" "}
            <InfoTooltip
              side="bottom"
              text="Пока узла хранения нет, вложения лежат на диске главного сервера. Как только настроенный узел появился, новые файлы уходят на него сразу, а накопленные переносятся здесь — порциями, чтобы это не мешало работе. Адрес файла при переезде не меняется: ссылки в переписке продолжают работать. Если узел недоступен, загрузка не падает — файл остаётся на главном сервере и уедет позже."
            />
          </h2>
          {!files ? (
            <p className="mt-2 text-xs text-neutral-400">Загрузка…</p>
          ) : (
            <>
              <p className="mt-2 text-xs text-neutral-500 dark:text-gray-400">
                Всего {files.total} · на главном сервере {files.onMain}
                {files.byNode.map((n) => ` · ${n.name}: ${n.count}`).join("")}
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">
                Новые файлы:{" "}
                {files.target ? (
                  <span className="text-green-600 dark:text-green-400">{files.target.name}</span>
                ) : (
                  "главный сервер (узел хранения не настроен)"
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {files.target && files.onMain > 0 && (
                  <button
                    type="button"
                    disabled={moving}
                    onClick={() => void moveFiles({ action: "migrate", limit: 50 })}
                    className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                  >
                    {moving ? "Перенос…" : `Перенести на «${files.target.name}» (по 50)`}
                  </button>
                )}
                {files.byNode.map((n) => (
                  <button
                    key={n.nodeId}
                    type="button"
                    disabled={moving}
                    onClick={() => {
                      if (!window.confirm(`Вернуть файлы узла «${n.name}» на главный сервер? Порция — 50 файлов.`)) return;
                      void moveFiles({ action: "restore", nodeId: n.nodeId, limit: 50 });
                    }}
                    className="text-neutral-600 hover:underline dark:text-gray-300 disabled:opacity-50"
                  >
                    Вернуть с «{n.name}» (по 50)
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Добавление ── */}
        <section className="rounded-xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Добавить узел{" "}
            <InfoTooltip
              side="bottom"
              text={
                "Дочернему узлу токен агента выпускается сразу. Главному серверу токен не нужен — это и есть приложение, в котором вы сейчас находитесь." +
                (form.kind === "VPN"
                  ? " Точка подключения — IP или домен машины, куда клиенты стучатся по UDP. Порт можно не писать, подставится 51820, а приставку «https://» мы уберём сами."
                  : "")
              }
            />
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input placeholder="Название, например vpn-nl-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {/* VPN-ENDPOINT: у VPN-узла нет и не может быть http-адреса. Связка
                работает «на вытягивание» — мы к узлу не обращаемся вообще, а
                клиентам нужен host:port по UDP. Поле поэтому меняется вместе с
                назначением: спрашивать «https://…» для WireGuard было
                бессмысленно, и введённое значение молча отбрасывалось. */}
            {form.kind === "VPN" ? (
              <Input
                placeholder="Точка подключения, например 203.0.113.10"
                value={form.endpointHost}
                onChange={(e) => setForm({ ...form, endpointHost: e.target.value })}
              />
            ) : (
              <Input
                placeholder="Адрес, например https://vpn1.example.ru"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            )}
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              aria-label="Роль узла"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-white"
            >
              <option value="CHILD">Дочерний</option>
              <option value="MAIN">Главный</option>
            </select>
            {/* SERVER-MESH: честно о том, что назначение меняет. Работают два:
                Соединение (выбор узла для нового подключения и рассылка списка) и
                Хранилище (на настроенный узел уезжают загруженные файлы).
                «Медиа» и «Вычисления» — по-прежнему пометки для учёта. */}
            <div className="flex items-center gap-1.5">
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                aria-label="Назначение узла"
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-white"
              >
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <InfoTooltip text="Работают три назначения. Соединение: по нему выбирается узел для нового доступа и ему уходит список подключений. Хранилище: на такой узел уезжают загруженные файлы, после того как в его карточке заданы адрес и ключ доступа. Сборка: агенту с этим назначением разрешено брать задачи сборки приложений. Медиа и вычисления — пометки для учёта, ни на что не влияют." />
            </div>
            {/* VPN-TRANSPORT: тип подключения виден только здесь. В интерфейсе
                пользователя он не отображается и в профиле никак не подписан. */}
            {form.kind === "VPN" && (
              <select
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value })}
                aria-label="Тип подключения"
                className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-white"
              >
                {TRANSPORT_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
            <Input placeholder="Регион (необязательно)" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            <Input placeholder="Заметка (необязательно)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <button
            type="button"
            onClick={create}
            disabled={creating || !form.name.trim()}
            className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:hover:bg-cyan-400 dark:text-neutral-950"
          >
            {creating ? "Добавление…" : "Добавить"}
          </button>
        </section>
      </div>
    </div>
  );
}
