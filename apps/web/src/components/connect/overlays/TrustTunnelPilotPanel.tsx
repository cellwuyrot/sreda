"use client";

import { useCallback, useEffect, useState } from "react";
import BusinessSubscriptionActions from "@/components/subscriptions/BusinessSubscriptionActions";
import { getVpnBridge } from "@/lib/vpnBridge";
import { getTrustTunnelEngine, type TrustTunnelEngine } from "@/lib/trustTunnelClient";
import ConnectionModalFrame from "./ConnectionModalFrame";

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

/** User-facing control for the project-selected reliable connection. */
export default function TrustTunnelPilotPanel({ onClose, selector }: { onClose: () => void; selector?: React.ReactNode }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [otherVpnActive, setOtherVpnActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [launchError, setLaunchError] = useState("");

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
    try {
      const next = await engine.status();
      setStatus(next);
      if (next.state === "on") setLaunchError("");
    } catch { setStatus({ state: "error", error: "Не удалось проверить состояние соединения" }); }
  }, []);

  const refreshOtherVpn = useCallback(async () => {
    const bridge = getVpnBridge();
    if (!bridge) { setOtherVpnActive(null); return; }
    try {
      const current = await bridge.status();
      setOtherVpnActive(current.state === "error" ? null : current.state === "on" || current.state === "connecting" || current.state === "disconnecting");
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
    setBusy(true);
    setMessage("");
    try {
      const result = await bridge.down();
      if (result.state !== "off") throw new Error("other vpn");
      setOtherVpnActive(false);
      await refreshOtherVpn();
    } catch {
      setMessage("Не удалось отключить другое подключение. Отключите его в приложении и повторите попытку.");
    } finally { setBusy(false); }
  };

  const connect = async () => {
    const currentEngine = getTrustTunnelEngine();
    if (!currentEngine || busy || !access?.serviceEnabled || !access.available || !access.eligible || (access.enabled && !access.applied) || otherVpnActive !== false) return;
    setBusy(true);
    setMessage("");
    setLaunchError("");
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
        setMessage("Настраиваем подключение на сервере. Оно станет доступно после подтверждения применения.");
        return;
      }
      if (!("config" in data) || typeof data.config !== "string") throw new Error("response");
      // Connection data is handed directly to the native bridge and never rendered or stored in web UI.
      const next = await currentEngine.up(data.config);
      setStatus(next);
    } catch (error) {
      setLaunchError(error instanceof Error && error.message !== "profile" && error.message !== "response"
        ? error.message : "Не удалось подготовить подключение. Проверьте доступ и состояние сервиса.");
    } finally { setBusy(false); }
  };

  const stopLocal = async (local: TrustTunnelEngine): Promise<EngineStatus> => {
    let result = await local.down();
    // Android posts an asynchronous stop and may initially report "on".
    for (let i = 0; i < 30 && ["on", "connecting", "disconnecting"].includes(result.state); i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      result = await local.status();
    }
    return result;
  };

  const disconnect = async () => {
    const currentEngine = getTrustTunnelEngine();
    if (!currentEngine || busy) return;
    setBusy(true);
    setMessage("");
    setLaunchError("");
    try {
      const next = await stopLocal(currentEngine);
      setStatus(next);
      setMessage(next.state === "off" ? "TrustTunnel отключён. Проверьте доступ к интернету." : next.error || "Не удалось отключить соединение.");
    } catch { setMessage("Не удалось отключить соединение. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  };

  // These operations are independent of the status API: cleanup must remain
  // reachable after an error or while access is being revoked.
  const manageProfile = async (action: "revoke" | "rotate") => {
    if (busy) return;
    const question = action === "revoke"
      ? "Отозвать профиль TrustTunnel? Подключения с ним перестанут работать после синхронизации сервера."
      : "Пересоздать профиль TrustTunnel? Старый профиль перестанет работать после синхронизации сервера.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setMessage("");
    try {
      const local = getTrustTunnelEngine();
      if (local) {
        const stopped = await stopLocal(local);
        setStatus(stopped);
        if (stopped.state !== "off") throw new Error("Не удалось отключить соединение на устройстве. Повторите отключение и подтвердите запрос системы.");
      }
      const response = await fetch("/api/vpn/trusttunnel/config", action === "revoke"
        ? { method: "DELETE", cache: "no-store" }
        : { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate: true }) });
      if (!response.ok) throw new Error("Не удалось изменить профиль на сервере. Проверьте доступ к TrioZ и повторите попытку.");
      const result = await response.json();
      setMessage(action === "revoke"
        ? "Запрос на отзыв сохранён. Сервер применит его при следующей синхронизации."
        : result.applied === true ? "Новый профиль готов." : "Новый профиль создан; ожидаем применения на сервере.");
      await refreshAccess();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось изменить профиль."); }
    finally { setBusy(false); }
  };

  const toggle = () => active ? void disconnect() : void connect();
  // The first provisioning request is allowed before the Endpoint has created an access row.
  const powerReady = !!engine && !!access?.serviceEnabled && !!access.available && !!access.eligible && (!access.enabled || access.applied) && !waitingForApply && otherVpnActive === false && !busy && !transitional;

  let stateText = "Проверяем состояние…";
  let stateTone: "success" | "accent" | "muted" | "warning" | "danger" = "muted";
  if (status?.state === "on" && status.confirmed === true) { stateText = "Клиент подтвердил соединение"; stateTone = "success"; }
  else if (status?.state === "on") { stateText = "Служба TrustTunnel запущена"; stateTone = "success"; }
  else if (active && !access?.selected) stateText = "Соединение ещё активно — отключите его";
  else if (!access) stateText = "Не удалось проверить доступ";
  else if (!access.selected) stateText = "Эта технология сейчас не выбрана для проекта";
  else if (!access.serviceEnabled) stateText = "Сервис отключён администратором";
  else if (!access.available) { stateText = "Сервис временно недоступен"; stateTone = "warning"; }
  else if (!access.eligible) stateText = "Нет активного доступа";
  else if (otherVpnActive) stateText = "Сначала отключите другое подключение";
  else if (engine && otherVpnActive === null) { stateText = "Не удалось проверить другое соединение"; stateTone = "warning"; }
  else if (status?.state === "connecting") { stateText = "Подключаемся…"; stateTone = "accent"; }
  else if (status?.state === "disconnecting") { stateText = "Отключаемся…"; stateTone = "accent"; }
  else if (status?.state === "error") { stateText = "Не удалось подключиться"; stateTone = "danger"; }
  else if (access.agentError) { stateText = "Ошибка применения доступа"; stateTone = "danger"; }
  else if (waitingForApply) { stateText = "Ожидаем применение на сервере"; stateTone = "accent"; }
  else if (access.enabled && access.applied) stateText = "Готово к включению";
  else if (!access.enabled) stateText = "Готово к первому подключению";
  else stateText = "Доступ готовится к подключению";

  const statusDescription = status?.state === "on" && status.confirmed === true
    ? "Подключение подтверждено приложением. Доступность отдельных сайтов зависит от сети."
    : status?.state === "on"
      ? "Служба работает. Прохождение трафика через VPN отдельно не проверено."
      : waitingForApply
        ? "Настройки применяются на сервере. Состояние будет проверено автоматически."
        : access?.selected && access.available && access.eligible && !access.enabled
          ? "При первом включении подготовим подключение. Оно станет доступно после подтверждения сервера."
          : "Нажмите круглую кнопку, чтобы включить или выключить соединение.";

  const notice = (
    <>
      {engine && (active || status?.state === "error") && <button type="button" disabled={busy} onClick={() => void disconnect()} className="mt-4 min-h-11 w-full rounded-xl border border-blue-500 px-3 text-sm font-medium text-blue-700 disabled:opacity-50 dark:text-blue-300">Отключить TrustTunnel</button>}
      {otherVpnActive && (
        <div className="mt-5 rounded-2xl border border-violet-300/70 bg-violet-50 p-3 dark:border-violet-400/20 dark:bg-violet-500/[0.08]">
          <p className="text-sm font-medium">Уже активно другое подключение</p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-white/60">Одновременно можно использовать только одно защищённое подключение.</p>
          <button type="button" disabled={busy} onClick={() => void disconnectOtherVpn()} className="mt-3 min-h-11 w-full rounded-xl border border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-violet-300/30 dark:text-violet-200 dark:hover:bg-violet-500/10">
            Отключить другое соединение
          </button>
        </div>
      )}
      {status?.state === "error" && status.error && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{status.error}</p>}
      {launchError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{launchError}</p>}
      {message && <p role="alert" className="mt-4 rounded-xl bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-violet-700 dark:text-violet-200">{message}</p>}
      {access?.agentError && <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">Не удалось применить настройки на сервере. Подключение пока недоступно.</p>}
      {access?.available === false && access.selected && <p role="status" className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">Сервис временно недоступен. Повторите попытку позже.</p>}
    </>
  );

  return (
    <ConnectionModalFrame
      selector={selector}
      theme="reliable"
      eyebrow="TZ Premium · Надёжное соединение"
      title="Надёжное соединение"
      subtitle="Одно соединение для Premium и «Ускоренного интернета»"
      onClose={onClose}
      power={{
        onClick: toggle,
        disabled: (!active && !powerReady) || busy || transitional,
        pressed: status?.state === "on",
        transitional,
        label: active ? "Отключить надёжное соединение" : "Подключить надёжное соединение",
        hint: powerReady ? "Подключить надёжное соединение" : stateText,
      }}
      status={{ title: stateText, description: statusDescription, tone: stateTone }}
      plan={{
        label: access?.planLabel ?? "Проверяем тариф…",
        periodLabel: access ? "по данным аккаунта" : "—",
        note: access?.eligible
          ? "Надёжное соединение доступно по вашему тарифу."
          : "Для подключения нужна активная подписка «Надёжное соединение» или Premium.",
      }}
      notice={notice}
    >
      <div className="mt-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
        <p className="text-xs font-medium text-neutral-800 dark:text-white/80">Подключение</p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">
          Параметры подключения задаются проектом и применяются автоматически. Выбирать сервер или режим вручную не требуется.
        </p>
      </div>

      {!access?.eligible && access?.selected && access.available && (
        <div className="mt-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
          <p className="text-xs font-medium text-neutral-800 dark:text-white/80">Доступ к соединению</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">Подключение появится после активации подписки.</p>
          <div className="mt-3 space-y-3">
            <BusinessSubscriptionActions kind="VPN" />
            <BusinessSubscriptionActions kind="PREMIUM" />
          </div>
        </div>
      )}

      {access?.eligible && !engine && (
        <p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-200">
          Для этого устройства требуется обновление приложения.
        </p>
      )}

      <div className="mt-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
        <p className="text-sm font-semibold">Восстановление и профиль</p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-white/70">Если интернет пропал, сначала отключите TrustTunnel. Защита может блокировать трафик до его отключения. Отзыв профиля на сервере не отключает клиент на устройстве.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || transitional} onClick={() => void manageProfile("rotate")} className="min-h-11 rounded-xl border border-violet-500 px-2 text-sm font-medium text-violet-700 disabled:opacity-50 dark:text-violet-300">Пересоздать профиль</button>
          <button type="button" disabled={busy || transitional} onClick={() => void manageProfile("revoke")} className="min-h-11 rounded-xl border border-neutral-400 px-2 text-sm font-medium disabled:opacity-50">Отозвать профиль</button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
        <p className="text-xs font-medium text-neutral-800 dark:text-white/80">Управление подключением</p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">
          Соединение включается прямо в приложении. Профиль скачивать или импортировать не нужно.
        </p>
      </div>
    </ConnectionModalFrame>
  );
}
