"use client";

/**
 * VPN-EMBEDDED: один источник истины для выключателя туннеля.
 *
 * Зачем отдельный хук. Включать туннель теперь можно из двух мест: значка TZ
 * в левой панели и круглой кнопки в окне Premium. Если каждое место будет
 * собирать профиль и звать оболочку само, они разойдутся при первой же правке —
 * и разойдутся молча: одна кнопка будет включать «весь трафик», другая — только
 * сервисы, и обьяснить разницу будет нечем.
 *
 * Почему ключи генерируются здесь, а не на сервере: приватный ключ не должен
 * покидать устройство. Наружу уезжает только публичный, а готовый профиль живёт
 * ровно до того, как уедет в оболочку по IPC.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { getDesktopApi, type DesktopVpnState } from "@/lib/desktop";
import { buildWireGuardConfig, generateWireGuardKeyPair } from "@/lib/wgKeys";

/** Режим маршрутизации: весь трафик или только сервисы проекта. */
export type TunnelRouting = "ALL" | "SERVICES";

/** Форма ответа `/api/vpn/me`, в той части, которая нужна выключателю. */
interface AccessState {
  entitled: boolean;
  serviceEnabled: boolean;
  nodeReady: boolean;
  routing: TunnelRouting;
}

export interface DesktopTunnel {
  /** Запущено ли приложение в оболочке со встроенным клиентом. */
  available: boolean;
  /** Состояние туннеля по данным оболочки (null — ещё не спрашивали). */
  state: DesktopVpnState | null;
  on: boolean;
  pending: boolean;
  /** Есть ли смысл в нажатии прямо сейчас. */
  canToggle: boolean;
  error: string;
  /** Переключить туннель. Возвращает `false`, если переключать было нечем. */
  toggle: () => Promise<boolean>;
}

/**
 * Состояние и переключение встроенного туннеля.
 *
 * В браузере хук безвреден: моста нет, `available` равен false, сетевых
 * запросов он тоже не делает — значок TZ там остаётся просто входом в окно.
 */
export function useDesktopTunnel(): DesktopTunnel {
  const bridge = useMemo(() => getDesktopApi()?.vpn ?? null, []);
  const [state, setState] = useState<DesktopVpnState | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  /* Туннель мог быть поднят до загрузки страницы (перезагрузка окна,
     обновление), поэтому сначала спрашиваем, а потом слушаем. */
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .status()
      .then((st) => {
        if (!cancelled) setState(st);
      })
      .catch(() => {
        /* старая сборка оболочки может не знать этого вызова — не повод ломать панель */
      });
    const off = bridge.onState((st) => setState(st));
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  /* Право на туннель считает сервер, а не признак Premium в интерфейсе: подписка
     «только VPN» тоже даёт доступ. Спрашиваем только в оболочке: в браузере
     выключателя нет, и лишний запрос никому не нужен. */
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/vpn/me");
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (cancelled || !data || typeof data !== "object") return;
        const routing = data.peer?.routing === "SERVICES" ? "SERVICES" : "ALL";
        setAccess({
          entitled: data.entitled === true,
          serviceEnabled: data.serviceEnabled === true,
          nodeReady: data.nodeReady === true,
          routing,
        });
      } catch {
        /* без ответа просто не предлагаем включение — окно Premium остаётся на месте */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const on = state?.state === "on";
  const transitioning = state?.state === "connecting" || state?.state === "disconnecting";
  const entitled = !!access?.entitled && !!access.serviceEnabled && !!access.nodeReady;
  const canToggle = !!bridge && !pending && !transitioning && (on || entitled);

  const toggle = useCallback(async (): Promise<boolean> => {
    if (!bridge || pending || transitioning) return false;
    setPending(true);
    setError("");
    try {
      if (on) {
        setState(await bridge.down());
        return true;
      }
      if (!entitled) return false;

      /* Профиль всегда свежий: ключ мог быть перевыпущен на другом устройстве,
         и старый молча не работал бы. */
      const pair = generateWireGuardKeyPair();
      const res = await fetch("/api/vpn/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: pair.publicKey, routing: access?.routing ?? "ALL" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.peer) {
        setError(data?.error || "Не удалось выдать доступ");
        return false;
      }
      const peer = data.peer;
      if (!peer.tunnel?.serverPublicKey || !peer.tunnel?.endpoint) {
        setError("Сервер не готов принять подключение");
        return false;
      }
      const config = buildWireGuardConfig({
        privateKey: pair.privateKey,
        address: peer.address,
        dns: peer.tunnel.dns,
        serverPublicKey: peer.tunnel.serverPublicKey,
        endpoint: peer.tunnel.endpoint,
        allowedIps: peer.tunnel.allowedIps,
        extra: peer.tunnel.extra ?? null,
      });
      setState(await bridge.up(config));
      return true;
    } catch {
      setError("Не удалось переключить соединение");
      return false;
    } finally {
      setPending(false);
    }
  }, [bridge, pending, transitioning, on, entitled, access?.routing]);

  return {
    available: !!bridge,
    state,
    on,
    pending: pending || transitioning,
    canToggle,
    error: error || (state?.state === "error" ? state.error ?? "" : ""),
    toggle,
  };
}
