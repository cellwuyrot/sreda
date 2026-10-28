"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumMark from "@/components/connect/PremiumMark";
import { LINK_NAME, LINK_PLAN_QUOTED } from "@/lib/connectionCopy";
import BusinessSubscriptionActions from "@/components/subscriptions/BusinessSubscriptionActions";
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
  const active = peer?.enabled === true && serviceEnabled && entitled;
  const accessKnown = typeof state?.entitled === "boolean";

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
          style={{ borderColor: "var(--cn-sidebar, #14161c)" }}
        />
      )}

      {open && (
        <div className={`absolute z-50 mt-2 w-[min(360px,calc(100vw-32px))] max-h-[min(80vh,640px)] overflow-y-auto rounded-2xl border p-4 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
          style={{ background: "var(--cn-sidebar, #14161c)", borderColor: "var(--cn-border, #3a3f47)", color: "var(--cn-text, #f3f4f6)" }} role="dialog" aria-label={LINK_NAME}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-base font-semibold">{LINK_NAME}</p><p className="mt-1 text-sm opacity-75">Подписка, подключение и профиль</p></div>
            <button type="button" aria-label="Закрыть меню соединения" onClick={() => setOpen(false)} className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-white/10 focus-visible:outline focus-visible:outline-2">×</button>
          </div>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm">{error}{stale ? ". Последние данные могут быть неактуальны." : ". Это не означает, что подписка закончилась."}</p>}
          {notice && <p role="status" className="mt-3 rounded-lg bg-green-500/10 p-3 text-sm">{notice}</p>}
          {loading && <p role="status" className="mt-3 text-sm opacity-75">Проверяем доступ…</p>}
          {!loading && (!state || !accessKnown) && <button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-lg border border-current px-3 text-sm">Повторить проверку доступа</button>}
          {state && accessKnown && <div className="mt-4 space-y-4">
            <div className="rounded-xl border p-3" style={{ borderColor: "var(--cn-border, #3a3f47)" }}>
              <p className="text-sm opacity-75">{entitled ? "Ваш доступ" : "Подключение услуги"}</p>
              <p className="mt-1 text-base font-semibold">{planLabel}</p>
              {entitled && <p className="mt-1 text-sm opacity-75">{plan?.until ? daysLeftLabel(plan.until) : "Без ограничения срока"}</p>}
              {!entitled && <p className="mt-2 text-sm opacity-75">Оформите подписку в Business. После подтверждения оплаты доступ появится в этом аккаунте TZ ID.</p>}
            </div>
            {entitled && <>
              {!serviceEnabled && <p role="status" className="text-sm">Сервис временно выключен. Подписка от этого не меняется.</p>}
              <p className="text-sm opacity-75">{active ? "Профиль активен. Состояние соединения на устройстве — в окне подключения." : "Откройте подключение, чтобы включить соединение в приложении или скачать профиль в браузере."}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!onOpenPremiumInfo} onClick={() => { setOpen(false); onOpenPremiumInfo?.(); }} className="min-h-11 min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: "#87dfd8", color: "#132625" }}>Открыть подключение</button>
                {peer?.enabled && <button type="button" disabled={busy} onClick={() => void disconnect()} className="min-h-11 rounded-xl border border-red-400/40 px-3 py-2.5 text-sm disabled:opacity-50">Отключить профиль</button>}
              </div>
              {servers.length > 0 && <details className="rounded-xl border p-3" style={{ borderColor: "var(--cn-border, #3a3f47)" }}><summary className="cursor-pointer text-sm font-medium">Сервер подключения</summary><div className="mt-3 space-y-2">{servers.map(server => {
                const chosen = !!peer?.nodeId && server.id === peer.nodeId;
                return <button key={server.id} type="button" disabled={busy || chosen || server.full === true || !peer} onClick={() => void switchServer(server.id)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60" style={{ borderColor: chosen ? "var(--cn-accent)" : "var(--cn-border)", background: chosen ? "var(--cn-accent-dim)" : "transparent" }}><span className="min-w-0 break-words">{server.name} {server.region || ""}</span><span className="shrink-0">{chosen ? "Выбран" : server.full ? "Нет мест" : "Доступен"}</span></button>;
              })}{!peer && <p className="text-sm opacity-75">Сервер можно выбрать после создания профиля.</p>}</div></details>}
            </>}
            <BusinessSubscriptionActions kind={plan?.kind === "premium" && entitled ? "PREMIUM" : "VPN"} active={entitled} compact />
            <a href="/settings?cat=subscriptions" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Все подписки и возможности</a>
          </div>}
        </div>
      )}
    </div>
  );
}
