"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import BackButton from "@/components/ui/BackButton"; // BACK-STEP
import Spinner from "@/components/ui/Spinner";
import Input from "@/components/ui/Input";
import InfoTooltip from "@/components/ui/InfoTooltip";

/**
 * VPN-PANEL: управление сервисом VPN.
 *
 * Выключатель здесь настоящий: при выключении узлам в ответе на отчёт уходит
 * пустой список пиров, и через минуту все туннели реально отпадают. Кнопка,
 * которая прячет интерфейс, но оставляет доступ рабочим, хуже отсутствия кнопки.
 *
 * VPN-PANEL2: со страницы убраны список выданных доступов и сводка по выдаче.
 * Выдача автоматическая (право даёт Premium), поэтому «кому выдано» — это просто
 * список тех, у кого есть подписка: панель повторяла бы раздел «Пользователи»,
 * не давая администратору ни одного решения. А раз списка нет, то и отзывать
 * доступ поштучно нечем и не нужно: снимается он снятием Premium, то есть там же,
 * где выдаётся.
 *
 * Осталось ровно то, чем здесь можно управлять: выключатель, параметры туннеля и
 * состояние узлов.
 */

interface Settings {
  enabled: boolean;
  dns: string;
  allowedIps: string;
  /* VPN-ROUTING: маршруты второго варианта, который человек выбирает при
     включении VPN. Что считать «сервисами TZ», знает только администратор. */
  serviceAllowedIps: string;
  maxPeersPerNode: number;
}

/** Состояние узла считает сервер — он же знает и отчёт, и точку подключения. */
type NodeState = "READY" | "FULL" | "NO_ENDPOINT" | "NO_KEY" | "NO_REPORT" | "DISABLED";

interface NodeRow {
  id: string;
  name: string;
  region: string;
  endpoint: string | null;
  transport: string;
  obfuscationMissing: boolean;
  peers: number;
  capacity: number;
  lastSeenAt: string | null;
  state: NodeState;
}

/* Каждое состояние = что происходит + что с этим делать. Технический ярлык вроде
   «нет отчёта» сам по себе ничего администратору не сообщает. */
const NODE_STATE: Record<NodeState, { label: string; tone: string; what: string }> = {
  READY: {
    label: "Готов",
    tone: "bg-green-500/15 text-green-600 dark:text-green-400",
    what: "Принимает новые устройства.",
  },
  FULL: {
    label: "Заполнен",
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    what: "Достигнут потолок устройств. Поднимите потолок выше или добавьте ещё один узел.",
  },
  NO_ENDPOINT: {
    label: "Нет точки подключения",
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    what: "Узел на связи, но клиентам некуда подключаться: укажите его IP или домен в «Серверах».",
  },
  NO_KEY: {
    label: "Нет ключа узла",
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    what: "Агент отчитался, но не сообщил публичный ключ WireGuard — проверьте, что интерфейс wg0 поднят.",
  },
  NO_REPORT: {
    label: "Агент не на связи",
    tone: "bg-red-500/15 text-red-600 dark:text-red-400",
    what: "Узел не отчитывался больше двух минут. Запустите агент на машине или перевыпустите токен.",
  },
  DISABLED: {
    label: "Отключён",
    tone: "bg-neutral-500/15 text-neutral-500 dark:text-neutral-400",
    what: "Узел выключен в «Серверах» — устройства на него не садятся.",
  },
};

const DNS_PRESETS = [
  { value: "1.1.1.1", label: "Cloudflare", note: "быстрый, без логов" },
  { value: "8.8.8.8", label: "Google", note: "самый стабильный" },
  { value: "94.140.14.14", label: "AdGuard", note: "режет рекламу и трекеры" },
];

const ALL_TRAFFIC = "0.0.0.0/0, ::/0";
/* Подсеть указана строкой: `lib/vpn.ts` сюда не подходит — он тянет prisma в
   клиентский бандл. Значение то же, что `VPN_SUBNET_PREFIX` там и в агенте. */
const TZ_ONLY = "10.8.0.0/24";

/** Те же границы, что проверяет PATCH: одна /24 минус адрес самого узла. */
const MIN_PEERS = 1;
const MAX_PEERS = 253;

function seenText(iso: string | null): string {
  if (!iso) return "ни разу не отчитывался";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "отчёт только что";
  if (minutes < 60) return `отчёт ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `отчёт ${hours} ч назад`;
  return `отчёт ${Math.floor(hours / 24)} дн назад`;
}

/** Полоска загрузки узла: число «12 / 200» словами не читается, полоска — сразу. */
function LoadBar({ peers, capacity }: { peers: number; capacity: number }) {
  const share = capacity > 0 ? Math.min(100, Math.round((peers / capacity) * 100)) : 0;
  const tone = share >= 100 ? "bg-red-500" : share >= 80 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${share}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        {peers} из {capacity} устройств{share >= 80 && share < 100 ? " — узел почти полон" : ""}
      </p>
    </div>
  );
}

export default function AdminVpnPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /* Черновик параметров: правки не уходят на сервер до «Сохранить», иначе каждый
     символ в поле DNS был бы отдельной записью в базу. */
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") router.push("/connect");
  }, [session, status, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/vpn");
      if (!res.ok) throw new Error("Не удалось загрузить настройки VPN");
      const data = await res.json();
      const loaded: Settings = { ...data.settings, serviceAllowedIps: data.settings?.serviceAllowedIps ?? TZ_ONLY };
      setSettings(loaded);
      setDraft(loaded);
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.role === "ADMIN") void load();
  }, [session, load]);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };

  const patch = async (body: Partial<Settings>, message?: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/vpn", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Не удалось сохранить"); return; }
      const saved: Settings = { ...data.settings, serviceAllowedIps: data.settings?.serviceAllowedIps ?? TZ_ONLY };
      setSettings(saved);
      setDraft(saved);
      setError("");
      if (message) flash(message);
    } catch {
      setError("Ошибка сети");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950"><Spinner /></div>;
  }
  if (session?.user?.role !== "ADMIN") return null;

  const ready = nodes.filter((n) => n.state === "READY");
  const dirty = !!settings && !!draft && (
    settings.dns !== draft.dns ||
    settings.allowedIps !== draft.allowedIps ||
    settings.serviceAllowedIps !== draft.serviceAllowedIps ||
    settings.maxPeersPerNode !== draft.maxPeersPerNode
  );
  /* Границы проверяет и сервер, но ловить их кнопкой лучше, чем ошибкой после
     нажатия: администратор набирает «0» и сразу видит, почему нельзя. */
  const peersValid = !!draft && draft.maxPeersPerNode >= MIN_PEERS && draft.maxPeersPerNode <= MAX_PEERS;
  /* «Обычное значение» варианта «весь трафик» — против ручного списка подсетей.
     Вариант «только сервисы TZ» задаётся строкой всегда: готового значения для
     чужого проекта не существует, кроме подсети самого туннеля. */
  const routeMode = draft && draft.allowedIps !== ALL_TRAFFIC ? "custom" : "all";
  const dnsCustom = !!draft && !DNS_PRESETS.some((p) => p.value === draft.dns);

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-6 sm:px-6 dark:bg-neutral-950">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <BackButton fallback="/admin" className="text-sm text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white">← Назад</BackButton>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">VPN</h1>
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        {notice && <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-500">{notice}</p>}

        {loading || !settings || !draft ? (
          <p className="text-sm text-neutral-400">Загрузка…</p>
        ) : (
          <>
            {/* ── Выключатель ── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Сервис VPN</h2>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-gray-400">
                    {settings.enabled
                      ? ready.length > 0
                        ? `Работает. Готовых узлов: ${ready.length} — устройства подключаются.`
                        : "Включён, но ни один узел не готов принимать устройства — смотрите список ниже."
                      : "Выключен: новые подключения не выдаются, а действующие туннели сняты."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    patch(
                      { enabled: !settings.enabled },
                      settings.enabled
                        ? "Сервис выключен — узлы снимут туннели в течение минуты"
                        : "Сервис включён",
                    )
                  }
                  className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                    settings.enabled
                      ? "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400"
                      : "bg-violet-600 text-white hover:bg-violet-700 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
                  }`}
                >
                  {settings.enabled ? "Выключить" : "Включить"}
                </button>
              </div>
              <p className="mt-3 rounded-lg bg-amber-400/[0.08] px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                Выключение действует по-настоящему: узлам уходит пустой список, и все подключения
                прерываются в течение минуты. Ничего при этом не теряется — после включения доступ
                вернётся сам.
              </p>
            </section>

            {/* ── Параметры туннеля ── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Что получают устройства{" "}
                <InfoTooltip
                  side="bottom"
                  text="Эти значения уходят в профиль WireGuard в момент выдачи доступа. Новые подхватит только следующая выдача: у тех, кто уже подключён, маршруты и DNS останутся прежними, пока они не перевыпустят профиль."
                />
              </h2>

              {/* VPN-ROUTING: режим выбирает человек при включении. Здесь задаётся
                  только смысл каждого из двух вариантов — какие подсети в него
                  входят. Выбирать за всех нельзя: «сменить свой адрес в
                  интернете» и «дотянуться до сервисов TZ» — разные задачи. */}
              <div className="mt-4">
                <p className="text-xs font-medium text-neutral-700 dark:text-white/80">
                  Какой трафик идёт через VPN{" "}
                  <InfoTooltip text="Из этих двух вариантов человек выбирает сам при включении VPN. Здесь задаётся, что каждый вариант означает." />
                </p>

                {/* Вариант 1 — весь трафик */}
                <div className="mt-2 rounded-xl border border-neutral-200 p-3 dark:border-white/10">
                  <span className="block text-sm font-medium text-neutral-900 dark:text-white">Весь трафик</span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-gray-400">
                    Всё с устройства идёт через узел. Адрес подменяется, но и вся нагрузка на узле.
                  </span>
                  {routeMode === "custom" ? (
                    <Input
                      className="mt-2"
                      value={draft.allowedIps}
                      onChange={(e) => setDraft({ ...draft, allowedIps: e.target.value })}
                      placeholder="Например: 0.0.0.0/0, ::/0"
                    />
                  ) : (
                    <code className="mt-2 block text-[11px] text-neutral-500 dark:text-gray-400">{draft.allowedIps}</code>
                  )}
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, allowedIps: routeMode === "custom" ? ALL_TRAFFIC : "" })}
                    className="mt-2 text-[11px] text-neutral-500 hover:underline dark:text-gray-400"
                  >
                    {routeMode === "custom" ? "Вернуться к обычному значению" : "Указать подсети вручную"}
                  </button>
                </div>

                {/* Вариант 2 — только сервисы TZ */}
                <div className="mt-2 rounded-xl border border-neutral-200 p-3 dark:border-white/10">
                  <span className="block text-sm font-medium text-neutral-900 dark:text-white">
                    Только сервисы TZ{" "}
                    <InfoTooltip text="Адреса самого проекта: подсеть туннеля и, если нужно, публичные адреса серверов TZ. Остальной трафик у человека пойдёт напрямую, минуя узел." />
                  </span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-gray-400">
                    Через узел идёт только TZ. Быстрее, но внешний адрес не меняется.
                  </span>
                  <Input
                    className="mt-2"
                    value={draft.serviceAllowedIps}
                    onChange={(e) => setDraft({ ...draft, serviceAllowedIps: e.target.value })}
                    placeholder={TZ_ONLY}
                  />
                </div>
              </div>

              {/* DNS — готовые варианты плюс своё поле */}
              <div className="mt-5">
                <p className="text-xs font-medium text-neutral-700 dark:text-white/80">
                  Через какой DNS искать сайты{" "}
                  <InfoTooltip text="Пока туннель включён, устройство спрашивает адреса сайтов именно у этого сервера." />
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DNS_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, dns: p.value })}
                      className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        draft.dns === p.value
                          ? "border-violet-500 bg-violet-500/[0.06] text-neutral-900 dark:border-cyan-400 dark:text-white"
                          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                      }`}
                    >
                      {p.label} <span className="text-neutral-400">· {p.note}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, dns: dnsCustom ? DNS_PRESETS[0].value : "" })}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      dnsCustom
                        ? "border-violet-500 bg-violet-500/[0.06] text-neutral-900 dark:border-cyan-400 dark:text-white"
                        : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5"
                    }`}
                  >
                    Свой
                  </button>
                </div>
                {dnsCustom && (
                  <Input
                    className="mt-2"
                    value={draft.dns}
                    onChange={(e) => setDraft({ ...draft, dns: e.target.value })}
                    placeholder="Например: 192.168.1.1 или 1.1.1.1, 1.0.0.1"
                  />
                )}
              </div>

              {/* Потолок — с живым следствием, а не абстрактным числом */}
              <div className="mt-5">
                <p className="text-xs font-medium text-neutral-700 dark:text-white/80">Сколько устройств пускать на один узел</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Input
                    className="w-28"
                    inputMode="numeric"
                    value={String(draft.maxPeersPerNode)}
                    onChange={(e) => setDraft({ ...draft, maxPeersPerNode: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  />
                  <p className="text-[11px] text-neutral-500 dark:text-gray-400">
                    {!peersValid
                      ? `Допустимо от ${MIN_PEERS} до ${MAX_PEERS}: столько адресов есть в подсети одного узла.`
                      : nodes.length === 0
                        ? "Узлов пока нет, поэтому потолок ни на что не влияет."
                        : `Узлов ${nodes.length} — вместимость сервиса примерно ${nodes.length * draft.maxPeersPerNode} устройств. Когда узел заполнен, новые устройства идут на следующий.`}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={saving || !dirty || !peersValid}
                  onClick={() =>
                    patch(
                      {
                        dns: draft.dns,
                        allowedIps: draft.allowedIps,
                        serviceAllowedIps: draft.serviceAllowedIps,
                        maxPeersPerNode: draft.maxPeersPerNode,
                      },
                      "Параметры сохранены",
                    )
                  }
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
                >
                  {saving ? "Сохранение…" : "Сохранить"}
                </button>
                {dirty && (
                  <button
                    type="button"
                    onClick={() => setDraft(settings)}
                    className="text-xs text-neutral-500 hover:underline dark:text-gray-400"
                  >
                    Отменить изменения
                  </button>
                )}
              </div>
            </section>

            {/* ── Узлы ── */}
            <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Узлы{" "}
                  <InfoTooltip
                    side="bottom"
                    text="Машины с WireGuard, через которые устройства выходят наружу. Пока ни один узел не готов, доступ не выдаётся никому."
                  />
                </h2>
                <Link href="/admin/servers" className="text-xs text-violet-600 hover:underline dark:text-cyan-400">
                  Добавить или настроить →
                </Link>
              </div>

              {nodes.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-neutral-200 p-4 dark:border-white/10">
                  <p className="text-xs font-medium text-neutral-700 dark:text-white/80">Узлов ещё нет. Три шага:</p>
                  <ol className="mt-2 ml-4 list-decimal space-y-1 text-[11px] text-neutral-500 dark:text-gray-400">
                    <li>
                      В <Link href="/admin/servers" className="text-violet-600 hover:underline dark:text-cyan-400">Серверах</Link>{" "}
                      добавьте узел с назначением «VPN» и укажите его IP — токен агента покажется один раз.
                    </li>
                    <li>Поднимите на машине интерфейс WireGuard и запустите агент с этим токеном.</li>
                    <li>Через минуту узел появится здесь со состоянием «Готов».</li>
                  </ol>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {nodes.map((node) => {
                    const meta = NODE_STATE[node.state];
                    return (
                      <div key={node.id} className="rounded-xl border border-neutral-200 p-3 dark:border-white/10">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-neutral-900 dark:text-white">{node.name}</span>
                          {node.region && <span className="text-[11px] text-neutral-400">{node.region}</span>}
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}>{meta.label}</span>
                          <span className="ml-auto text-[11px] text-neutral-400">{seenText(node.lastSeenAt)}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-neutral-500 dark:text-gray-400">{meta.what}</p>
                        <p className="mt-1 text-[11px] text-neutral-400">
                          Точка подключения: {node.endpoint ?? "не задана"}
                          {" · "}
                          {node.transport === "OBFUSCATED" ? "устойчивый к блокировкам" : "обычный"}
                        </p>
                        {node.obfuscationMissing && (
                          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                            Узел объявлен устойчивым, но параметров ещё не прислал — пока выдаётся
                            обычное подключение.
                          </p>
                        )}
                        <LoadBar peers={node.peers} capacity={node.capacity} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
