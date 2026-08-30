"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumMark from "@/components/connect/PremiumMark";
import { LINK_NAME, LINK_PLAN_QUOTED } from "@/lib/connectionCopy";
import { daysLeftLabel, formatTraffic } from "@/lib/connectionUsage";

/**
 * NETLINK: кнопка «TZ» — состояние соединения, а не только вход в окно.
 *
 * Всё, что человек спрашивает чаще всего — «включено ли», «сколько осталось
 * трафика», «до какого числа подписка», «можно ли сменить сервер», — живёт здесь.
 *
 * Выдача ключей СОЗНАТЕЛЬНО не дублируется: приватный ключ рождается только в
 * браузере и показывается один раз — его надо успеть сохранить, а узкая плашка,
 * закрывающаяся по клику мимо, для этого не место. Кнопка отвечает на вопросы и
 * переключает сервер; выдача осталась в окне, на которое ведёт «Настроить».
 *
 * ВАЖНОЕ об устойчивости. Все поля ответа считаются НЕОБЯЗАТЕЛЬНЫМИ, даже если
 * сервер всегда их присылает. Первая же версия читала `state.traffic.overLimit`
 * напрямую — и при ответе без этого поля (старый сервер, кэш оболочки,
 * незавершённое развёртывание) рендер падал, а вместе с ним граница ошибок
 * убирала весь мессенджер. Кнопка в углу не вправе уносить с собой переписку.
 */

interface ServerChoice {
  id: string;
  name: string;
  region?: string;
  load?: number;
  full?: boolean;
  ready?: boolean;
  current?: boolean;
}

interface ConnectionState {
  serviceEnabled?: boolean;
  entitled?: boolean;
  nodeReady?: boolean;
  plan?: {
    kind?: "premium" | "link" | "none";
    label?: string;
    note?: string;
    until?: string | null;
  } | null;
  traffic?: {
    usedBytes?: number;
    limitBytes?: number;
    /** Без лимита — null, а не большое число. */
    remainingBytes?: number | null;
    /** Доля расхода 0…100, уже в процентах. */
    share?: number;
    overLimit?: boolean;
    periodEnd?: string;
    limitGb?: number;
    overLimitAction?: string;
    throttleKbps?: number;
  } | null;
  servers?: ServerChoice[] | null;
  peer?: { enabled?: boolean; nodeId?: string; node?: { name?: string; region?: string } | null } | null;
}

interface ConnectionMenuProps {
  isPremium: boolean;
  /** Открыть окно Premium: там выдаются ключи и собирается профиль. */
  onOpenPremiumInfo?: () => void;
  /** Сторона значка: 44 в левой панели, 36 в мобильной шапке. */
  size?: number;
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
      const data: unknown = await res.json();
      /* Ответ проверяется на тип, а не принимается на веру: строка или null вместо
         объекта иначе дойдёт до рендера и сломает его. */
      setState(data && typeof data === "object" ? (data as ConnectionState) : {});
      setError("");
    } catch (e) {
      setState(null);
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setLoading(false);
    }
  }, []);

  /* Состояние запрашивается только при открытии: значок на виду всегда, и фоновый
     опрос ради числа, которое никто не смотрит, — запрос на каждого открытого клиента. */
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
      const data = (await res.json().catch(() => null)) as { error?: string; needsReissue?: boolean } | null;
      if (!res.ok) {
        setError(data?.error || "Не удалось сменить сервер");
        return;
      }
      setError("");
      /* Смена сервера меняет адрес и точку подключения, поэтому старый профиль на
         устройстве перестаёт работать. Об этом надо сказать сразу: иначе тишина
         после переезда читается как поломка сервиса. */
      flash(
        data?.needsReissue
          ? "Сервер сменён. Получите новый файл подключения в «Настроить» — прежний больше не работает"
          : "Готово",
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
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Не удалось выключить");
        return;
      }
      setError("");
      flash("Соединение выключено");
      await load();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  /* ── Безопасные значения ──
     Всё, что ниже идёт в разметку, берётся только отсюда: ни одного чтения
     вложенного поля ответа напрямую. */
  const peer = state?.peer ?? null;
  const traffic = state?.traffic ?? null;
  const plan = state?.plan ?? null;
  const servers = Array.isArray(state?.servers) ? (state?.servers as ServerChoice[]) : [];
  const serviceEnabled = state?.serviceEnabled !== false;
  const entitled = state?.entitled === true;
  const limitGb = typeof traffic?.limitGb === "number" ? traffic.limitGb : null;
  const usedBytes = typeof traffic?.usedBytes === "number" ? traffic.usedBytes : 0;
  const remainingBytes = typeof traffic?.remainingBytes === "number" ? traffic.remainingBytes : null;
  const overLimit = traffic?.overLimit === true;
  const share = typeof traffic?.share === "number" ? Math.max(0, Math.min(100, traffic.share)) : 0;
  const throttleMbits = typeof traffic?.throttleKbps === "number" ? Math.round((traffic.throttleKbps / 1024) * 10) / 10 : 0;
  const planLabel = plan?.label || (entitled ? "Доступ есть" : `Нет подписки ${LINK_PLAN_QUOTED}`);
  const active = !!peer && serviceEnabled && entitled && !overLimit;
  const tone = share >= 100 ? "bg-red-500" : share >= 80 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="relative" ref={boxRef}>
      <PremiumMark isPremium={isPremium} onClick={() => setOpen((v) => !v)} size={size} asToggle={false} />
      {/* Крошечная метка состояния: «включено или нет» видно без открытия плашки. */}
      {peer && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 ${
            active ? "bg-green-500" : "bg-amber-500"
          }`}
          style={{ borderColor: "var(--cn-panel, #14161c)" }}
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
                    : !serviceEnabled
                      ? "Сервис временно выключен"
                      : active
                        ? "Включено"
                        : peer
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
              <div className="mt-3 rounded-lg px-2.5 py-2" style={{ background: "var(--cn-hover)" }}>
                <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  Тариф
                </p>
                <p className="text-xs font-medium">
                  {planLabel}
                  {plan?.until ? (
                    <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                      · {daysLeftLabel(plan.until)}
                    </span>
                  ) : plan?.kind && plan.kind !== "none" ? (
                    <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                      · без срока
                    </span>
                  ) : null}
                </p>
              </div>

              {/* Остаток трафика — полоской: два больших числа рядом глазом не
                  сравниваются, а длина — сравнивается. */}
              {traffic && (
                <div className="mt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                      Трафик
                    </p>
                    <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                      {limitGb === null || limitGb === 0
                        ? "без ограничения"
                        : `до ${limitGb} ГБ${traffic.periodEnd ? ` · сброс ${daysLeftLabel(traffic.periodEnd)}` : ""}`}
                    </p>
                  </div>
                  {limitGb !== null && limitGb > 0 && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className={`h-full rounded-full ${tone}`} style={{ width: `${share}%` }} />
                    </div>
                  )}
                  <p className="mt-1 text-xs font-medium">
                    {limitGb === null || limitGb === 0
                      ? `Израсходовано ${formatTraffic(usedBytes)}`
                      : overLimit
                        ? "Лимит исчерпан"
                        : `Осталось ${formatTraffic(remainingBytes ?? 0)}`}
                    {/* FIX-TRAFFIC-DUP: спан «израсходовано» показывался даже когда limitGb=0,
                       в этом случае текст уже содержал «Израсходовано X ГБ» — дублирование. */}
                    {limitGb !== null && limitGb > 0 && (
                      <span className="ml-1 font-normal" style={{ color: "var(--cn-muted)" }}>
                        · израсходовано {formatTraffic(usedBytes)}
                      </span>
                    )}
                  </p>
                  {overLimit && (
                    <p className="mt-1 text-[11px] text-amber-400">
                      {traffic.overLimitAction === "THROTTLE"
                        ? `Скорость снижена до ${throttleMbits} Мбит/с до конца периода.`
                        : "Соединение отключено до конца периода."}
                    </p>
                  )}
                </div>
              )}

              {/* Выбор сервера — только те, куда действительно можно сесть. */}
              <div className="mt-3">
                <p className="text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  Сервер
                </p>
                {servers.length === 0 ? (
                  <p className="mt-1 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                    Свободных серверов сейчас нет — попробуйте позже.
                  </p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {servers.map((server) => {
                      const chosen = !!peer?.nodeId && server.id === peer.nodeId;
                      return (
                        <button
                          key={server.id}
                          type="button"
                          disabled={busy || chosen || server.full === true || !peer}
                          onClick={() => void switchServer(server.id)}
                          className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-60"
                          style={{
                            borderColor: chosen ? "var(--cn-accent)" : "var(--cn-border)",
                            background: chosen ? "var(--cn-accent-dim)" : "transparent",
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {server.name}
                            {server.region ? (
                              <span className="ml-1" style={{ color: "var(--cn-muted)" }}>
                                {server.region}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-[10px]" style={{ color: "var(--cn-muted)" }}>
                            {server.full === true ? "нет мест" : "доступен"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!peer && servers.length > 0 && (
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
                  {peer ? "Настроить" : entitled ? "Включить" : "Оформить"}
                </button>
                {peer && (
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

              {!entitled && (
                <p className="mt-2 text-[11px]" style={{ color: "var(--cn-muted)" }}>
                  {plan?.note ||
                    `Соединение входит в Premium и в подписку ${LINK_PLAN_QUOTED} — условия у них одинаковые.`}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
