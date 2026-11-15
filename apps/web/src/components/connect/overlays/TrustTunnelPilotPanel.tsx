"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BusinessSubscriptionActions from "@/components/subscriptions/BusinessSubscriptionActions";
import { XIcon } from "@/components/ui/ConnectIcons";
import { getVpnBridge } from "@/lib/vpnBridge";
import { getTrustTunnelEngine, type TrustTunnelEngine } from "@/lib/trustTunnelClient";

type TunnelState = "off" | "connecting" | "on" | "disconnecting" | "error";
type EngineStatus = { state: TunnelState; error: string | null; confirmed?: boolean };
type Access = {
  activeProvider: "AMNEZIAWG" | "TRUSTTUNNEL" | null;
  selected: boolean;
  serviceEnabled: boolean;
  available: boolean;
  eligible: boolean;
  enabled: boolean;
  applied: boolean;
  agentError?: boolean;
  planLabel: string;
};

/** User-facing TrustTunnel control. Private profile text never enters the DOM. */
export default function TrustTunnelPilotPanel({ onClose }: { onClose: () => void }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [otherVpnActive, setOtherVpnActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  const refreshAccess = useCallback(async () => {
    try {
      const response = await fetch("/api/vpn/trusttunnel", { cache: "no-store" });
      if (!response.ok) throw new Error("access");
      const data = await response.json();
      setAccess({
        activeProvider: data.activeProvider === "TRUSTTUNNEL" || data.activeProvider === "AMNEZIAWG" ? data.activeProvider : null,
        selected: data.selected === true,
        serviceEnabled: data.serviceEnabled === true,
        available: data.available === true,
        eligible: data.eligible === true,
        enabled: data.enabled === true,
        applied: data.applied === true,
        agentError: data.agentError === true,
        planLabel: typeof data.planLabel === "string" ? data.planLabel : "Доступ не подтверждён",
      });
    } catch {
      setAccess(null);
    }
  }, []);

  const refreshEngine = useCallback(async () => {
    const engine = getTrustTunnelEngine();
    if (!engine) { setStatus(null); return; }
    try { setStatus(await engine.status()); }
    catch { setStatus({ state: "error", error: "Не удалось проверить состояние соединения" }); }
  }, []);

  const refreshOtherVpn = useCallback(async () => {
    const bridge = getVpnBridge();
    if (!bridge) { setOtherVpnActive(null); return; }
    try {
      const current = await bridge.status();
      setOtherVpnActive(current.state === "on" || current.state === "connecting" || current.state === "disconnecting");
    } catch { setOtherVpnActive(null); }
  }, []);

  useEffect(() => {
    void refreshAccess();
    void refreshEngine();
    void refreshOtherVpn();
    const timer = setInterval(() => {
      void refreshAccess();
      void refreshEngine();
      void refreshOtherVpn();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshAccess, refreshEngine, refreshOtherVpn]);

  const engine: TrustTunnelEngine | null = getTrustTunnelEngine();
  const active = status?.state === "on" || status?.state === "connecting" || status?.state === "disconnecting";
  const transitional = status?.state === "connecting" || status?.state === "disconnecting";
  const waitingForApply = access?.enabled === true && access.applied !== true;

  const disconnectOtherVpn = async () => {
    const bridge = getVpnBridge();
    if (!bridge || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await bridge.down();
      if (result.state !== "off") throw new Error("other vpn");
      setOtherVpnActive(false);
      await refreshOtherVpn();
    } catch {
      setMessage("Не удалось отключить другое соединение TrioZ. Отключите его в приложении и повторите попытку.");
    } finally { setBusy(false); }
  };

  const connect = async () => {
    const currentEngine = getTrustTunnelEngine();
    if (!currentEngine || busy || !access?.serviceEnabled || !access.available || !access.eligible || (access.enabled && !access.applied) || otherVpnActive) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/vpn/trusttunnel/config", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate: false }),
      });
      if (!response.ok) throw new Error("profile");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("applied" in data)) throw new Error("response");
      await refreshAccess();
      if (data.applied !== true) {
        setMessage("Настраиваем доступ на сервере. Подключение станет доступно после подтверждения применения.");
        return;
      }
      if (!("config" in data) || typeof data.config !== "string") throw new Error("response");
      // Profile is passed directly to the native bridge and is never displayed or persisted in web code.
      const next = await currentEngine.up(data.config);
      setStatus(next);
      if (next.state === "error" && next.error) setMessage(next.error);
    } catch (error) {
      setMessage(error instanceof Error && error.message !== "profile" && error.message !== "response"
        ? error.message : "Не удалось подготовить подключение. Проверьте доступ и состояние сервиса.");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    const currentEngine = getTrustTunnelEngine();
    if (!currentEngine || busy) return;
    setBusy(true); setMessage("");
    try {
      setStatus(await currentEngine.down());
    } catch {
      setMessage("Не удалось отключить соединение. Попробуйте ещё раз.");
    } finally { setBusy(false); }
  };

  const toggle = () => active ? void disconnect() : void connect();
  // An entitled user without a TrustTunnelAccess row must be able to make the
  // first provisioning request; only subsequent connects wait for the Endpoint ACK.
  const powerReady = !!engine && !!access?.serviceEnabled && !!access.available && !!access.eligible && (!access.enabled || access.applied) && !waitingForApply && !otherVpnActive && !busy && !transitional;

  let stateText = "Проверяем состояние…";
  let stateTone = "text-neutral-500 dark:text-white/55";
  if (active && !access?.selected) stateText = "Соединение ещё активно — отключите его";
  else if (!access) stateText = "Не удалось проверить доступ";
  else if (!access.selected) stateText = "Эта технология сейчас не выбрана для проекта";
  else if (!access.serviceEnabled) stateText = "Сервис отключён администратором";
  else if (!access.available) stateText = "Сервис временно недоступен";
  else if (!access.eligible) stateText = "Нет активного доступа";
  else if (otherVpnActive) stateText = "Сначала отключите другое соединение TrioZ";
  else if (status?.state === "connecting") { stateText = "Подключаемся…"; stateTone = "text-violet-600 dark:text-violet-300"; }
  else if (status?.state === "disconnecting") { stateText = "Отключаемся…"; stateTone = "text-violet-600 dark:text-violet-300"; }
  else if (status?.state === "on" && status.confirmed === true) { stateText = "Клиент подтвердил соединение"; stateTone = "text-emerald-600 dark:text-emerald-400"; }
  else if (status?.state === "on") { stateText = "Служба запущена; прохождение трафика не подтверждено"; stateTone = "text-amber-600 dark:text-amber-300"; }
  else if (status?.state === "error") { stateText = "Не удалось подключиться"; stateTone = "text-red-600 dark:text-red-400"; }
  else if (access.agentError) { stateText = "Ошибка синхронизации сервера"; stateTone = "text-red-600 dark:text-red-400"; }
  else if (waitingForApply) { stateText = "Ожидаем применение на сервере"; stateTone = "text-violet-600 dark:text-violet-300"; }
  else if (access.enabled && access.applied) stateText = "Готово к подключению";
  else if (!access.enabled) stateText = "Готово к первому подключению";
  else stateText = "Доступ готовится к подключению";

  return (
    <div ref={dialogRef} className="relative overflow-hidden p-6 text-neutral-900 dark:text-white" role="dialog" aria-modal="true" aria-labelledby="trusttunnel-title" tabIndex={-1}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,.18),transparent_62%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-violet-600 dark:text-violet-300">TrioZ · защищённое подключение</p>
            <h3 id="trusttunnel-title" className="mt-1 text-xl font-semibold">Надёжное соединение</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-white/45">Единый способ подключения, выбранный проектом</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-violet-500/10 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:text-white" aria-label="Закрыть">
            <XIcon size={16} style={{ color: "inherit" }} />
          </button>
        </div>

        <div className="mt-7 flex flex-col items-center">
          <button
            type="button"
            onClick={toggle}
            disabled={(!active && !powerReady) || busy || transitional}
            aria-pressed={status?.state === "on"}
            aria-label={active ? "Отключить надёжное соединение" : "Подключить надёжное соединение"}
            className={`relative grid h-28 w-28 place-items-center rounded-full border outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-4 dark:focus-visible:ring-offset-[#111317] disabled:cursor-not-allowed disabled:opacity-50 ${
              status?.state === "on" && status.confirmed === true
                ? "border-emerald-400/50 bg-emerald-500 text-white shadow-[0_0_45px_rgba(34,197,94,.28)]"
                : active ? "border-violet-400/60 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  : "border-violet-300 bg-violet-50 text-violet-600 shadow-inner dark:border-violet-400/20 dark:bg-violet-500/[0.08] dark:text-violet-200"
            }`}
          >
            <span className="absolute inset-2 rounded-full border border-current opacity-15" />
            {transitional && <span className="absolute inset-0 animate-ping rounded-full border border-violet-400/50" />}
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M12 2v10" /><path d="M6.35 5.35a8 8 0 1 0 11.3 0" />
            </svg>
          </button>
          <strong className={`mt-4 text-center text-sm ${stateTone}`} aria-live="polite">{stateText}</strong>
          <span className="mt-1 max-w-xs text-center text-[11px] leading-relaxed text-neutral-400 dark:text-white/40">
            {status?.state === "on" && status.confirmed === true
              ? "Клиент подтвердил состояние подключённого туннеля. Это не гарантирует доступность каждого отдельного сайта."
              : status?.state === "on"
                ? "Windows сообщает о запущенной службе; отдельная проверка доступности туннеля пока не подключена."
                : waitingForApply
                  ? "Обычно применение занимает до двух минут. Не закрывайте окно для повторной проверки состояния."
                  : access?.selected && access.available && access.eligible && !access.enabled
                    ? "При первом нажатии подготовим доступ на сервере. Подключение станет доступно после подтверждения Endpoint."
                    : "Нажмите кнопку, чтобы включить или выключить защищённое соединение."}
          </span>
        </div>

        {otherVpnActive && (
          <div className="mt-5 rounded-2xl border border-violet-300/70 bg-violet-50 p-3 dark:border-violet-400/20 dark:bg-violet-500/[0.08]">
            <p className="text-sm font-medium">Уже активно другое соединение TrioZ</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-white/60">Одновременно можно использовать только одну VPN-технологию TrioZ.</p>
            <button type="button" disabled={busy} onClick={() => void disconnectOtherVpn()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-violet-300/30 dark:text-violet-200 dark:hover:bg-violet-500/10">
              Отключить другое соединение
            </button>
          </div>
        )}

        {message && <p role="alert" className="mt-4 rounded-xl bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-violet-700 dark:text-violet-200">{message}</p>}
        {access?.agentError && <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">Сервер сообщил об ошибке применения доступа. Подключение пока недоступно.</p>}

        <div className="mt-6 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-white/35">Доступ</span>
            <span className="text-[11px] text-neutral-400 dark:text-white/35">по данным аккаунта</span>
          </div>
          <strong className="mt-1 block text-sm">{access?.planLabel ?? "Проверяем тариф…"}</strong>
          {!access?.eligible && access?.selected && access.available && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-neutral-600 dark:text-white/60">Для подключения нужна активная подписка «Надёжное соединение» или Premium.</p>
              <BusinessSubscriptionActions kind="VPN" />
              <BusinessSubscriptionActions kind="PREMIUM" />
            </div>
          )}
          {access?.eligible && !engine && (
            <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-200">На этом устройстве нет встроенного клиента TrustTunnel. Обновите приложение TrioZ до версии с поддержкой надёжного соединения.</p>
          )}
          {access?.available === false && access.selected && (
            <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-200">Серверная часть сейчас недоступна. Повторите попытку позже или обратитесь к администратору проекта.</p>
          )}
        </div>

        <button type="button" onClick={onClose} className="mt-5 min-h-11 w-full rounded-xl border border-neutral-200 px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/10 dark:text-white/65 dark:hover:bg-white/5">
          Закрыть
        </button>
      </div>
    </div>
  );
}
