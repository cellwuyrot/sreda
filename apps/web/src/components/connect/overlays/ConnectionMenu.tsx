"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumMark from "@/components/connect/PremiumMark";
import { LINK_NAME, LINK_PLAN_QUOTED } from "@/lib/connectionCopy";
import { daysLeftLabel } from "@/lib/connectionUsage";

/**
 * NETLINK: кнопка «TZ» — состояние соединения, а не только вход в окно.
 *
 * Всё, что человек спрашивает чаще всего — «включено ли», «до какого числа
 * подписка», «можно ли сменить сервер», — живёт здесь.
 *
 * Выдача ключей СОЗНАТЕЛЬНО не дублируется: приватный ключ рождается только в
 * браузере и показывается один раз — его надо успеть сохранить, а узкая плашка,
 * закрывающаяся по клику мимо, для этого не место. Кнопка отвечает на вопросы и
 * переключает сервер; выдача осталась в окне, на которое ведёт «Настроить».
 *
 * ВАЖНОЕ об устойчивости. Все поля ответа считаются НЕОБЯЗАТЕЛЬНЫМИ, даже если
 * сервер всегда их присылает. Ответ со старой/частичной формой не должен ломать
 * панель или весь мессенджер. Кнопка в углу не вправе уносить с собой переписку.
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
  const [stale, setStale] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  /* Не стираем последний честный снимок из-за краткой ошибки сети. Реф нужен,
     чтобы обработчик загрузки не зависел от самого снимка и не пересоздавался. */
  const hasStateRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vpn/me", { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось получить состояние");
      const data: unknown = await res.json();
      /* Ответ проверяется на тип, а не принимается на веру: строка или null вместо
         объекта иначе дойдёт до рендера и сломает его. */
      setState(data && typeof data === "object" ? (data as ConnectionState) : {});
      hasStateRef.current = true;
      setStale(false);
      setError("");
    } catch (e) {
      /* Последний ответ может быть полезен, но после неудачного обновления он
         обязан быть помечен как устаревший, а не выглядеть текущим. */
      setStale(hasStateRef.current);
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

  const peer = state?.peer ?? null;
  const plan = state?.plan ?? null;
  const servers = Array.isArray(state?.servers) ? (state?.servers as ServerChoice[]) : [];
  const serviceEnabled = state?.serviceEnabled !== false;
  const entitled = state?.entitled === true;
  const planLabel = plan?.label || (entitled ? "Доступ есть" : `Нет подписки ${LINK_PLAN_QUOTED}`);
  const active = !!peer && serviceEnabled && entitled;

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
                    ? "Состояние недоступно"
                    : stale
                      ? "Данные могут быть неактуальны"
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
