"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumMark from "@/components/connect/PremiumMark";
import { LINK_NAME, LINK_PLAN_QUOTED } from "@/lib/connectionCopy";
import { daysLeftLabel, formatTraffic } from "@/lib/connectionUsage";

/**
 * NETLINK: кнопка «TZ» — состояние соединения, а не только вход в окно.
 *
 * До этого значок умел ровно одно — открыть большое окно. Всё, что человек
 * спрашивает чаще всего — «включено ли», «сколько осталось трафика», «до какого
 * числа подписка», «можно ли сменить сервер», — требовало открыть окно и его
 * прочитать. Поэтому ответы переехали в саму кнопку.
 *
 * Выдача и перевыпуск ключей здесь СОЗНАТЕЛЬНО не дублируются: приватный ключ
 * рождается только в браузере и показывается один раз — для этого нужно место,
 * где его можно скопировать и сохранить, а не узкая плашка, закрывающаяся по
 * клику мимо. Кнопка отвечает на вопросы и переключает сервер; выдача осталась
 * в окне, на которое ведёт кнопка «Настроить».
 */

interface ServerChoice {
  id: string;
  name: string;
  region: string;
  load: number;
  full: boolean;
  ready: boolean;
  current: boolean;
}

interface ConnectionState {
  serviceEnabled: boolean;
  entitled: boolean;
  nodeReady: boolean;
  plan: { kind: "premium" | "link" | "none"; label: string; note: string; until: string | null };
  traffic: {
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
    share: number;
    overLimit: boolean;
    periodEnd: string;
    limitGb: number;
    overLimitAction: "BLOCK" | "THROTTLE";
    throttleKbps: number;
  };
  servers: ServerChoice[];
  peer: { enabled: boolean; nodeId: string; node: { name: string; region: string } } | null;
}

interface ConnectionMenuProps {
  isPremium: boolean;
  /** Открыть окно Premium: там выдаются ключи и собирается профиль. */
  onOpenPremiumInfo?: () => void;
  /** Сторона значка: 44 в левой панели, 36 в мобильной шапке. */
  size?: number;
  /** С какой стороны раскрывать плашку. */
  align?: "left" | "right";
}

export default function ConnectionMenu({
  isPremium,
  onOpenPremiumInfo,
  size = 44,
  align = "left",
}: ConnectionMenuProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConnectionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vpn/me");
      if (!res.ok) throw new Error("Не удалось получить состояние");
      setState((await res.json()) as ConnectionState);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, []);

  /* Состояние запрашивается только при открытии, а не на каждом рендере /connect:
     значок стоит на виду всегда, и фоновый опрос ради числа, которое никто не
     смотрит, — это запрос к базе на каждого открытого клиента. */
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };

  const switchServer = async (nodeId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/vpn/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Не удалось сменить сервер");
        return;
      }
      setError("");
      /* Смена сервера меняет адрес и точку подключения, поэтому старый профиль
         на устройстве перестаёт работать. Об этом надо сказать сразу: иначе
         человек решит, что сломалось соединение, а не что он сам переехал. */
      flash(
        data?.needsReissue
          ? "Сервер сменён. Перевыпустите профиль в «Настроить» — прежний больше не работает"
          : "Вы уже на этом сервере",
      );
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/vpn/me", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Не удалось выключить");
        return;
      }
      setError("");
      flash("Соединение выключено и ключ удалён");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const active = !!state?.peer && state.serviceEnabled && state.entitled && !state.traffic.overLimit;
  const share = state ? Math.min(100, Math.round(state.traffic.share * 100)) : 0;
  const tone = share >= 100 ? "bg-red-500" : share >= 80 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="relative" ref={boxRef}>
      <PremiumMark isPremium={isPremium} onClick={() => setOpen((v) => !v)} size={size} />
      {/* Крошечная метка состояния поверх значка: «включено или нет» видно без
          открытия плашки — иначе за ответом на главный вопрос пришлось бы кликать. */}
      {state?.peer && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${
            active ? "bg-green-500" : "bg-amber-500"
          }`}
          style={{ borderColor: "var(--cn-bg, #0b0d12)" }}
        />
      )}

      {open && (
        <div
          className={`absolute z-50 mt-2 w-[288px] rounded-xl border p-3 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{
            background: "var(--cn-panel, #14161c)",
            borderColor: "var(--cn-border)",
            color: "var(--cn-text)",
          }}
          role="dialog"
          aria-label={LINK_NAME}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{LINK_NAME}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                {loading
                  ? "Проверяем…"
                  : !state
                    ? "Состояние неизвестно"
                    : !state.serviceEnabled
                      ? "Сервис временно выключен"
                      : active
                        ? `Включено · ${state.peer?.node.name ?? ""}`
                        : state.peer
                          ? "Настроено, но не работает"
                          : "Выключено"}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                active ? "bg-green-500/15 text-green-400" : "bg-white/10"
              }`}
              style={active ? undefined : { color: "var(--cn-muted)" }}
            >
              {active ? "Вкл" : "Выкл"}
            </span>
          </div>

          {error && <p className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">{error}</p>}
          {notice && <p className="mt-2 rounded-lg bg-green-500/10 px-2 py-1.5 text-[11px] text-green-400">{notice}</p>}

          {state && (
            <>
              {/* Тариф и срок — одной строкой: вопрос всегда задают вместе. */}
              <div
                className="mt-3 rounded-lg px-2.5 py-2"
                style={{ background: "var(--cn-hover)" }}
              >
                <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  Тариф
                </p>
                <p className="text-xs font-medium">
                  {state.plan.kind === "none" ? `Нет подписки ${LINK_PLAN_QUOTED}` : state.plan.label}
                  {state.plan.until && (
                    <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                      · {daysLeftLabel(state.plan.until)}
                    </span>
                  )}
                  {!state.plan.until && state.plan.kind !== "none" && (
                    <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                      · без срока
                    </span>
                  )}
                </p>
              </div>

              {/* Остаток трафика — полоской: два больших числа рядом глазом не
                  сравниваются, а длина — сравнивается. */}
              <div className="mt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                    Трафик
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                    {state.traffic.limitGb === 0
                      ? "без ограничения"
                      : `до ${state.traffic.limitGb} ГБ · сброс ${daysLeftLabel(state.traffic.periodEnd)}`}
                  </p>
                </div>
                {state.traffic.limitGb > 0 && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${tone}`} style={{ width: `${share}%` }} />
                  </div>
                )}
                <p className="mt-1 text-xs font-medium">
                  {state.traffic.limitGb === 0
                    ? `Израсходовано ${formatTraffic(state.traffic.usedBytes)}`
                    : state.traffic.overLimit
                      ? "Лимит исчерпан"
                      : `Осталось ${formatTraffic(state.traffic.remainingBytes)}`}
                  <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                    · израсходовано {formatTraffic(state.traffic.usedBytes)}
                  </span>
                </p>
                {state.traffic.overLimit && (
                  <p className="mt-1 text-[11px] text-amber-400">
                    {state.traffic.overLimitAction === "BLOCK"
                      ? "Соединение отключено до конца периода."
                      : `Скорость снижена до ${Math.round((state.traffic.throttleKbps / 1024) * 10) / 10} Мбит/с до конца периода.`}
                  </p>
                )}
              </div>

              {/* Выбор сервера — только те, куда действительно можно сесть. */}
              <div className="mt-3">
                <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  Сервер
                </p>
                {state.servers.length === 0 ? (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                    Свободных серверов сейчас нет — попробуйте позже.
                  </p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {state.servers.map((server) => {
                      const chosen = state.peer ? server.id === state.peer.nodeId : false;
                      return (
                        <button
                          key={server.id}
                          type="button"
                          disabled={busy || chosen || server.full || !state.peer}
                          onClick={() => void switchServer(server.id)}
                          className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-60"
                          style={{
                            borderColor: chosen ? "var(--cn-accent)" : "var(--cn-border)",
                            background: chosen ? "var(--cn-accent-dim)" : "transparent",
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {server.name}
                            {server.region && (
                              <span className="ml-1" style={{ color: "var(--cn-muted)" }}>
                                {server.region}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[10px]" style={{ color: "var(--cn-muted)" }}>
                            {server.full ? "заполнен" : `загружен на ${server.load}%`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!state.peer && state.servers.length > 0 && (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                    Сервер можно выбрать после первого включения.
                  </p>
                )}
              </div>

              {/* Действия. «Включить» ведёт в окно: ключ показывается один раз и его
                  нужно успеть сохранить. */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenPremiumInfo?.();
                  }}
                  className="flex-1 rounded-lg px-3 py-2 text-xs font-medium"
                  style={{ background: "var(--cn-accent)", color: "var(--cn-accent-text)" }}
                >
                  {state.peer ? "Настроить" : state.entitled ? "Включить" : "Оформить"}
                </button>
                {state.peer && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void disconnect()}
                    className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-400 disabled:opacity-50"
                  >
                    Выключить
                  </button>
                )}
              </div>

              {!state.entitled && (
                <p className="mt-2 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  Соединение входит в Premium и в подписку {LINK_PLAN_QUOTED} — условия по соединению у них
                  одинаковые.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
