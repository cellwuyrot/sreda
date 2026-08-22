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
import { deviceKeyPair } from "@/lib/wgIdentity";
import { buildWireGuardConfig } from "@/lib/wgKeys";

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

/** Сколько всего ждём узел и с какой частотой спрашиваем. */
const PEER_WAIT_MS = 30_000;
const PEER_POLL_MS = 1_500;
/* Узел ставит пира сразу после того, как отчитался, но не мгновенно: между
   ответом сайта и `wg set` проходит доля секунды. Полторы секунды паузы
   дешевле, чем ещё один круг неотвеченных рукопожатий по пять секунд каждое. */
const PEER_SETTLE_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * FIX-PEERWAIT: дождаться, пока УЗЕЛ узнает о нашем ключе.
 *
 * Зачем ожидание вообще. Запись пира создаётся в базе сайта мгновенно, а на
 * узел она попадает только с его отчётом. Раньше здесь не было ничего:
 * `bridge.up(config)` вызывался сразу за POST, и при интервале отчёта в минуту
 * клиент стучался к узлу, который о нём ещё не слышал. Выглядело это как
 * полное отсутствие интернета на время попытки: маршруты уже уведены в
 * туннель, а туннель молчит.
 *
 * Почему опрос, а не фиксированная пауза: ждать надо ровно столько, сколько
 * нужно. При свежем отчёте это полторы–три секунды, и заставлять человека
 * смотреть на вращающийся значок минуту «на всякий случай» — такой же отказ,
 * только медленный.
 *
 * Ошибка сети внутри цикла не прерывает ожидание: один неудавшийся запрос —
 * ещё не приговор, а время на повторы отведено.
 *
 * @returns `true` — узел подтвердил пира; `false` — не дождались.
 */
async function waitPeerApplied(): Promise<boolean> {
  const deadline = Date.now() + PEER_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/vpn/me");
      const data = (res.ok ? await res.json().catch(() => null) : null) as {
        peerApplied?: unknown;
      } | null;
      if (data?.peerApplied === true) {
        await sleep(PEER_SETTLE_MS);
        return true;
      }
    } catch {
      /* сеть мигнула — пробуем снова, время на это есть */
    }
    await sleep(PEER_POLL_MS);
  }
  return false;
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

  /* Режим маршрутизации разворачиваем в простое значение ЗДЕСЬ, а не внутри
     toggle. Причина не в красоте: обращение к `access?.routing` из тела
     useCallback React Compiler видит как зависимость от всего объекта `access`,
     и список зависимостей перестаёт совпадать с выведенным — сборка падает на
     правиле react-hooks/preserve-manual-memoization. Строка вместо объекта
     заодно означает, что перезапрос доступа с тем же режимом не пересоздаёт
     обработчик. */
  const routing: TunnelRouting = access?.routing ?? "ALL";

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

      /* FIX-KEYSTICK: ключ у устройства ОДИН и тот же от включения к включению.
         Прежде здесь создавалась новая пара на каждое нажатие, сервер
         перезаписывал запись пира, а агент на узле удалял прежний ключ — вместе
         с уже работающим соединением. Подробности в lib/wgIdentity.ts. */
      const pair = deviceKeyPair();
      const res = await fetch("/api/vpn/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey: pair.publicKey, routing }),
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

      /* FIX-PEERWAIT: ключ зарегистрирован на сайте — теперь дожидаемся, пока о нём
         узнает сам узел, и только потом поднимаем туннель. Без этого ожидания
         включение было лотереей: совпало с отчётом узла — работает, не совпало —
         туннель поднят, а сервер молчит, и интернета нет вовсе. */
      if (!(await waitPeerApplied())) {
        setError(
          "Сервер не успел принять доступ. Нажмите включение ещё раз через полминуты",
        );
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
  }, [bridge, pending, transitioning, on, entitled, routing]);

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
