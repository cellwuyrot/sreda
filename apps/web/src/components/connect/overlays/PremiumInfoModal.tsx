"use client";

import { useCallback, useEffect, useState } from "react";
import { PREMIUM_KEY_FEATURES, PREMIUM_MAIN_ADVANTAGE } from "@/lib/premiumFeatures";
import PremiumFeatureIcon from "@/components/premium/PremiumFeatureIcon";
import { XIcon } from "@/components/ui/ConnectIcons"; // FIX-ICONS
import { buildWireGuardConfig, generateWireGuardKeyPair } from "@/lib/wgKeys"; // VPN-AUTOPREMIUM
import { LINK_PLAN_QUOTED } from "@/lib/connectionCopy";
import { isDesktop, getDesktopApi, type DesktopVpnState } from "@/lib/desktop"; // APP-ONLY // NETLINK // VPN-ONECLICK
import { daysLeftLabel, formatTraffic } from "@/lib/connectionUsage"; // NETLINK

/* REFACTOR-A: модалка TZ Premium / VPN — вынесена из app/connect/page.tsx.
   Для обычных аккаунтов — витрина подписки.

   VPN-AUTOPREMIUM: доступ больше не выдаётся администратором вручную. Признак
   Premium системе известен, поэтому повторять его вводом логина в панели было
   лишним шагом, который к тому же ограничивал выдачу рабочим временем админа.
   Теперь при открытии этого окна клиент сам создаёт пару ключей и регистрирует
   публичную половину — от пользователя не требуется ничего.

   Почему ключ рождается здесь, а не на сервере: приватная половина не должна
   существовать нигде, кроме устройства владельца. Она живёт только в памяти
   этой страницы, попадает в готовый профиль и не сохраняется даже у нас в
   localStorage.

   VPN-ONECLICK: профиль больше не отдаётся человеку файлом. Раньше окно строило
   `.conf` и предлагало скачать его для стороннего клиента (Amnezia) — то есть
   «включение» на деле было ручной установкой пакета. Теперь собранный профиль
   уходит прямо в десктоп-оболочку, и она поднимает туннель сама, по кнопке.
   В браузере системный туннель поднять физически нечем, поэтому там окно честно
   отправляет человека в приложение вместо выдачи файла.

   Свой X25519 (см. lib/wgKeys.ts), а не WebCrypto: X25519 в `crypto.subtle`
   появился только в Chromium 133, а десктоп-оболочка проекта собрана на
   Electron 33 — то есть именно там, где VPN нужнее всего, WebCrypto бы не
   сработал. */

type VpnRouting = "ALL" | "SERVICES";

interface VpnPeerState {
  address: string;
  exitIp: string;
  /* VPN-ROUTING: что идёт через туннель у этого человека. Выбор его, не админа. */
  routing: VpnRouting;
  lastHandshakeAt: string | null;
  node: { name: string; region: string } | null;
  tunnel: {
    serverPublicKey: string | null;
    endpoint: string | null;
    allowedIps: string;
    dns: string;
    serverAddress: string;
    /* Дополнительные строки в [Interface], если узел их требует. Клиент их не
       интерпретирует и нигде не показывает — просто вписывает в профиль. */
    extra?: Record<string, string | number> | null;
  };
}

/* NETLINK-2: то, что раньше показывала отдельная плашка над значком «TZ».
   Плашка убрана: два экрана об одном и том же расходятся тем быстрее, чем
   чаще правятся. Все поля необязательные: ответ без них (старый сервер,
   кэш оболочки) должен просто скрыть блок, а не уронить окно. */
interface PlanState {
  kind?: "premium" | "link" | "none";
  label?: string;
  note?: string;
  until?: string | null;
}

interface TrafficState {
  usedBytes?: number;
  remainingBytes?: number | null;
  share?: number;
  overLimit?: boolean;
  periodEnd?: string;
  limitGb?: number;
  overLimitAction?: string;
  throttleKbps?: number;
}

interface ServerChoice {
  id: string;
  name: string;
  region?: string;
  load?: number;
  full?: boolean;
  current?: boolean;
}

interface VpnState {
  serviceEnabled: boolean;
  entitled: boolean;
  nodeReady: boolean;
  peer: (VpnPeerState & { nodeId?: string }) | null;
  plan?: PlanState | null;
  traffic?: TrafficState | null;
  servers?: ServerChoice[] | null;
}

/* VPN-ROUTING: два варианта включения. Человек выбирает между «сменить свой адрес
   в интернете» и «дотянуться до сервисов TZ, не трогая остальной трафик» — выбор
   разный у разных людей и в разные дни, поэтому его нельзя решить за всех
   настройкой в панели. Какие именно подсети входят в каждый вариант, задаёт
   администратор; здесь только смысл. */
const ROUTING_OPTIONS: { value: VpnRouting; title: string; note: string }[] = [
  { value: "ALL", title: "Весь трафик компьютера", note: "Через сервер идёт всё. Внешний адрес меняется." },
  {
    value: "SERVICES",
    title: "Только приложение TZ",
    note: "В туннеле только TZ. Остальной интернет компьютера идёт напрямую.",
  },
];

/*
 * APP-ONLY: в десктоп-версии режим «только приложение» — не мелкая настройка, а главный
 * вопрос доверия: человек должен видеть без чтения документации, что банк-клиент,
 * рабочая VPN работодателя и весь прочий трафик компьютера остаются вне туннеля.
 * Поэтому в оболочке показываемявную плашку под выбором режима.
 */
function RoutingChoice({
  value,
  onChange,
  disabled,
  desktop,
}: {
  value: VpnRouting;
  onChange: (next: VpnRouting) => void;
  disabled?: boolean;
  desktop?: boolean;
}) {
  return (
    <div className="mt-5">
      <p className="text-xs font-medium text-neutral-700 dark:text-white/80">Что идёт через сервер</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {ROUTING_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
              value === option.value
                ? "border-violet-500 bg-violet-500/[0.06] dark:border-cyan-400 dark:bg-cyan-400/[0.06]"
                : "border-neutral-200 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
            }`}
          >
            <span className="block text-sm font-medium text-neutral-900 dark:text-white">{option.title}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">
              {option.note}
            </span>
          </button>
        ))}
      </div>
      {/* APP-ONLY */}
      {desktop && (
        <div
          className={`mt-2 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${
            value === "SERVICES"
              ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300"
              : "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 dark:text-amber-300"
          }`}
        >
          {value === "SERVICES" ? (
            <>
              <span className="font-semibold">Туннелирование только для приложения.</span> Интернет-трафик
              компьютера не перенаправляется: браузер, банк-клиент, игры и рабочая сеть
              работают напрямую, через сервер идёт только TZ.
            </>
          ) : (
            <>
              <span className="font-semibold">Весь трафик компьютера пойдёт через сервер.</span> Это касается
              всех программ, а не только TZ. Если нужно защитить только общение в TZ —
              выберите «Только приложение TZ».
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Короткая подпись под индикатором, когда туннель поднят: активен или молчит. */
function tunnelSinceLabel(iso: string | null): string {
  if (!iso) return "туннель поднят";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "подключено только что";
  if (minutes < 60) return `подключено ${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `подключено ${hours} ч назад`;
  return `подключено ${Math.floor(hours / 24)} дн назад`;
}

function VpnPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<VpnState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Выбранный режим до нажатия кнопки. В браузере по умолчанию «весь трафик» — этого
     от соединения и ждут. В десктоп-оболочке — наоборот (см. эффект ниже). */
  const [routing, setRouting] = useState<VpnRouting>("ALL");
  /*
   * APP-ONLY: оболочка определяется только в эффекте: window на сервере нет, а
   * чтение в теле компонента дало бы расхождение разметки при гидратации.
   */
  const [desktopShell, setDesktopShell] = useState(false);
  /* VPN-ONECLICK: умеет ли эта сборка оболочки реально поднимать туннель, и его
     живое состояние. В браузере и в старых сборках моста `vpn` нет — тогда
     включать нечем, и панель отправляет человека в приложение. */
  const [canTunnel, setCanTunnel] = useState(false);
  const [tunnel, setTunnel] = useState<DesktopVpnState | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    setDesktopShell(true);
    /* В установленном приложении безопасный по умолчанию выбор — туннель только для
       самого приложения: перекладывать весь интернет компьютера на чужой шлюз нужно
       только по явному желанию. Если профиль уже выдан, его режим приедет из
       refresh() и перекроет этот выбор. */
    setRouting((prev) => (prev === "ALL" ? "SERVICES" : prev));
  }, []);

  /* VPN-ONECLICK: снимок состояния туннеля при открытии окна (он мог быть поднят
     до загрузки страницы) и подписка на живые изменения. */
  useEffect(() => {
    const bridge = getDesktopApi()?.vpn;
    if (!bridge) return;
    setCanTunnel(true);
    let alive = true;
    bridge
      .status()
      .then((st) => {
        if (alive) setTunnel(st);
      })
      .catch(() => {});
    const off = bridge.onState((st) => setTunnel(st));
    return () => {
      alive = false;
      off();
    };
  }, []);

  /**
   * Зарегистрировать публичный ключ и собрать профиль прямо на устройстве.
   * Приватный ключ живёт только в этой функции и уходит лишь в возвращаемый
   * профиль — ни в localStorage, ни на сервер. Возвращает профиль или null
   * (ошибка либо узел ещё не сообщил параметры); текст ошибки уже выставлен.
   */
  const enroll = useCallback(async (mode: VpnRouting): Promise<string | null> => {
    const pair = generateWireGuardKeyPair();
    const res = await fetch("/api/vpn/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: pair.publicKey, routing: mode }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Не удалось выдать доступ");
      return null;
    }
    const peer = data.peer as VpnPeerState;
    setState((prev) => ({
      ...(prev ?? {}),
      serviceEnabled: prev?.serviceEnabled ?? true,
      entitled: prev?.entitled ?? true,
      nodeReady: prev?.nodeReady ?? true,
      peer,
    }));
    setError("");
    if (peer.tunnel.serverPublicKey && peer.tunnel.endpoint) {
      return buildWireGuardConfig({
        privateKey: pair.privateKey,
        address: peer.address,
        dns: peer.tunnel.dns,
        serverPublicKey: peer.tunnel.serverPublicKey,
        endpoint: peer.tunnel.endpoint,
        allowedIps: peer.tunnel.allowedIps,
        extra: peer.tunnel.extra ?? null,
      });
    }
    return null;
  }, []);

  /* VPN-ONECLICK: включить соединение. Собираем свежий профиль и тут же
     передаём его оболочке — она поднимает туннель. Файл никуда не сохраняется:
     профиль живёт ровно до того, как уедет в туннель. */
  const connect = useCallback(
    async (mode: VpnRouting) => {
      const bridge = getDesktopApi()?.vpn;
      if (!bridge) return;
      setBusy(true);
      try {
        const config = await enroll(mode);
        if (!config) return;
        const st = await bridge.up(config);
        setTunnel(st);
      } catch {
        setError("Не удалось поднять туннель в приложении");
      } finally {
        setBusy(false);
      }
    },
    [enroll],
  );

  const disconnectTunnel = useCallback(async () => {
    const bridge = getDesktopApi()?.vpn;
    if (!bridge) return;
    setBusy(true);
    try {
      const st = await bridge.down();
      setTunnel(st);
      setError("");
    } catch {
      setError("Не удалось выключить туннель");
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async (): Promise<VpnState | null> => {
    try {
      const res = await fetch("/api/vpn/me");
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (!data || typeof data !== "object") {
        setFailed(true);
        return null;
      }
      const next: VpnState = {
        serviceEnabled: data.serviceEnabled === true,
        entitled: data.entitled === true,
        nodeReady: data.nodeReady === true,
        peer: data.peer ?? null,
        plan: data.plan ?? null,
        traffic: data.traffic ?? null,
        servers: Array.isArray(data.servers) ? data.servers : [],
      };
      setState(next);
      setFailed(false);
      return next;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  /* Переезд на другой сервер меняет адрес и точку подключения. Если туннель
     сейчас поднят, сразу перекладываем его на новый узел свежим профилем: иначе
     прежний профиль на устройстве молча перестал бы работать. */
  const switchServer = async (nodeId: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/vpn/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error || "Не удалось сменить сервер");
        return;
      }
      setError("");
      await refresh();
      const wasUp = tunnel?.state === "on" || tunnel?.state === "connecting";
      if (getDesktopApi()?.vpn && wasUp) {
        await connect(routing);
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  /* Полный отзыв доступа: снять туннель и удалить пира на сервере. Нужен, когда
     человек уходит с устройства насовсем; обычное «выключить» запись о доступе
     не трогает, чтобы включить снова можно было одной кнопкой. */
  const revoke = async () => {
    setBusy(true);
    try {
      const bridge = getDesktopApi()?.vpn;
      if (bridge) {
        try {
          const st = await bridge.down();
          setTunnel(st);
        } catch {
          /* туннель мог быть уже снят — отзыву это не мешает */
        }
      }
      const res = await fetch("/api/vpn/me", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Не удалось отключить доступ");
        return;
      }
      setError("");
      await refresh();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void refresh().then((next) => {
      if (cancelled || !next) return;
      /* Прежний выбор режима подставляется, если пир уже есть. */
      if (next.peer) setRouting(next.peer.routing === "SERVICES" ? "SERVICES" : "ALL");
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /* VPN-ONECLICK: «активно» теперь означает поднятый ЛОКАЛЬНЫЙ туннель, а не
     рукопожатие серверной записи: именно он и есть то, что человек включил
     кнопкой. В браузере туннеля нет — значит и не активно. */
  const tunnelOn = tunnel?.state === "on";
  const tunnelConnecting = tunnel?.state === "connecting";
  const tunnelDisconnecting = tunnel?.state === "disconnecting";
  const active = canTunnel && tunnelOn;
  const nodeIncomplete = !!state?.peer && (!state.peer.tunnel.serverPublicKey || !state.peer.tunnel.endpoint);
  /* Ошибку туннеля показываем рядом с сетевыми ошибками — источник для человека один. */
  const shownError = error || (canTunnel ? tunnel?.error ?? "" : "");
  /* Всё для включения на месте: право есть, сервис включён, узел готов. */
  const ready = !!state?.entitled && !!state.serviceEnabled && state.nodeReady;

  /* NETLINK-2: ответ читается только через эти переменные. Прямое обращение к
     вложенным полям уже один раз уронило весь мессенджер, когда сервер ответил
     старой формой без traffic. Окно о соединении не вправе ронять клиент. */
  const plan = state?.plan ?? null;
  const traffic = state?.traffic ?? null;
  const servers = Array.isArray(state?.servers) ? state.servers : [];
  const limitGb = Number(traffic?.limitGb) || 0;
  const usedBytes = Number(traffic?.usedBytes) || 0;
  const remainingBytes =
    traffic?.remainingBytes === null || traffic?.remainingBytes === undefined
      ? null
      : Number(traffic.remainingBytes) || 0;
  const share = Number(traffic?.share) || 0;
  const overLimit = traffic?.overLimit === true;
  const throttleMbits = Math.max(1, Math.round((Number(traffic?.throttleKbps) || 0) / 1024));

  return (
    <div className="relative p-6 text-neutral-900 dark:text-white">
      <div className={`pointer-events-none absolute inset-0 opacity-70 ${active ? "bg-[radial-gradient(circle_at_50%_0%,rgba(34,197,94,.20),transparent_58%)]" : "bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,.14),transparent_58%)]"}`} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-400 dark:text-white/40">TZ Premium · Надёжное соединение</p>
            <h3 className="mt-1 text-xl font-semibold">Защищённое соединение</h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-white/45">Входит в Premium — включается одной кнопкой</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-white/[0.07] dark:hover:text-white" aria-label="Закрыть"><XIcon size={15} style={{ color: "inherit" }} /></button>
        </div>

        <div className="mt-7 flex flex-col items-center">
          <div
            className={`relative grid h-28 w-28 place-items-center rounded-full border transition-all duration-300 ${active
              ? "border-emerald-400/50 bg-emerald-500 text-white shadow-[0_0_45px_rgba(34,197,94,.34)]"
              : tunnelConnecting
              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-600 dark:text-cyan-300"
              : "border-neutral-300 bg-neutral-100 text-neutral-500 shadow-inner dark:border-white/10 dark:bg-white/[0.06] dark:text-white/50"}`}
            aria-hidden
          >
            <span className={`absolute inset-2 rounded-full border ${active ? "border-white/20" : "border-neutral-200 dark:border-white/[0.06]"}`} />
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 2v10" />
              <path d="M6.35 5.35a8 8 0 1 0 11.3 0" />
            </svg>
          </div>

          {state === null && !failed && (
            <strong className="mt-4 text-sm text-neutral-500 dark:text-white/50">Проверяем состояние…</strong>
          )}
          {failed && (
            <strong className="mt-4 text-sm text-neutral-600 dark:text-white/65">Состояние недоступно</strong>
          )}

          {state && !state.entitled && (
            <>
              <strong className="mt-4 text-sm text-neutral-600 dark:text-white/65">Нужна подписка</strong>
              <span className="mt-1 text-center text-[11px] text-neutral-400 dark:text-white/35">
                Подходит любая из двух: «Ускоренный интернет» или Premium. Доступ выдаётся сам, как только подписка активна.
              </span>
            </>
          )}

          {state?.entitled && !state.serviceEnabled && (
            <>
              <strong className="mt-4 text-sm text-neutral-600 dark:text-white/65">Сервис отключён</strong>
              <span className="mt-1 text-center text-[11px] text-neutral-400 dark:text-white/35">
                Сервис выключен администратором. Подключение недоступно, пока его не включат.
              </span>
            </>
          )}

          {state?.entitled && state.serviceEnabled && !state.nodeReady && (
            <>
              <strong className="mt-4 text-sm text-neutral-600 dark:text-white/65">Узлы ещё не готовы</strong>
              <span className="mt-1 text-center text-[11px] text-neutral-400 dark:text-white/35">
                Ни один сервер не вышел на связь. Включение станет доступно, как только узел появится.
              </span>
            </>
          )}

          {ready && canTunnel && (
            <>
              <strong className={`mt-4 text-sm ${active ? "text-emerald-600 dark:text-emerald-400" : tunnelConnecting ? "text-cyan-600 dark:text-cyan-300" : "text-neutral-600 dark:text-white/65"}`}>
                {active
                  ? "Соединение активно"
                  : tunnelConnecting
                  ? "Подключаем…"
                  : tunnelDisconnecting
                  ? "Выключаем…"
                  : "Готово к включению"}
              </strong>
              <span className="mt-1 text-center text-[11px] text-neutral-400 dark:text-white/35">
                {active
                  ? `${tunnelSinceLabel(tunnel?.since ?? null)} · режим: ${
                      ROUTING_OPTIONS.find((o) => o.value === state?.peer?.routing)?.title.toLowerCase() ?? "весь трафик"
                    }`
                  : tunnelConnecting
                  ? "Устанавливаем туннель — это занимает несколько секунд"
                  : "Выберите, что пойдёт через туннель, и нажмите «Включить»"}
              </span>
            </>
          )}

          {ready && !canTunnel && (
            <>
              <strong className="mt-4 text-sm text-neutral-600 dark:text-white/65">Включение — в приложении</strong>
              <span className="mt-1 text-center text-[11px] text-neutral-400 dark:text-white/35">
                {desktopShell
                  ? "Обновите приложение TZ\u00a0Connect до последней версии — в нём соединение поднимается одной кнопкой."
                  : "Соединение поднимается в приложении TZ\u00a0Connect для компьютера — в браузере системный туннель включить нельзя."}
              </span>
            </>
          )}
        </div>

        {shownError && (
          <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">{shownError}</p>
        )}
        {nodeIncomplete && (
          <p className="mt-4 rounded-xl bg-amber-400/[0.08] px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            Сервер соединения готовится — включение станет доступно через минуту.
          </p>
        )}

        {/* ── Тариф, расход и сервер ──
            NETLINK-2: раньше жило в отдельной плашке над значком. Каждое значение
            читается защитно: ответ без этих полей обязан просто скрыть блок. */}
        {plan && (
          <div className="mt-6 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.035]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[9px] uppercase tracking-wider text-neutral-400 dark:text-white/30">Тариф</span>
              <span className="text-[11px] text-neutral-400 dark:text-white/35">
                {plan.until ? daysLeftLabel(plan.until) : "без срока"}
              </span>
            </div>
            <strong className="mt-1 block text-sm">{plan.label || "Без подписки"}</strong>
            {plan.note && (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">{plan.note}</p>
            )}
            {plan.kind === "none" && (
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-white/40">
                Подходит любая из двух: {LINK_PLAN_QUOTED} или Premium.
              </p>
            )}
          </div>
        )}

        {traffic && (
          <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.035]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[9px] uppercase tracking-wider text-neutral-400 dark:text-white/30">Трафик</span>
              <span className="text-[11px] text-neutral-400 dark:text-white/35">
                {limitGb > 0 ? `до ${limitGb} ГБ` : "без ограничения"}
                {traffic.periodEnd ? ` · сброс ${daysLeftLabel(traffic.periodEnd)}` : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${overLimit ? "bg-red-500" : share > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.max(2, Math.min(100, share))}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-white/45">
              <strong className="text-neutral-900 dark:text-white">
                {remainingBytes === null ? "Без ограничения" : `Осталось ${formatTraffic(remainingBytes)}`}
              </strong>{" "}
              · израсходовано {formatTraffic(usedBytes)}
            </p>
            {overLimit && (
              <p className="mt-2 rounded-xl bg-amber-400/[0.08] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                {traffic.overLimitAction === "THROTTLE"
                  ? `Лимит исчерпан — скорость снижена до ${throttleMbits} Мбит/с до конца периода.`
                  : "Лимит исчерпан — соединение отключено до конца периода."}
              </p>
            )}
          </div>
        )}

        {/* Выбор сервера — только тому, кто действительно может подключиться из
            приложения: в браузере переезд ничего бы не поднял. */}
        {canTunnel && state?.peer && servers.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-neutral-700 dark:text-white/80">Сервер</p>
            <div className="mt-2 grid gap-2">
              {servers.map((server) => {
                const unavailable = !!server.full && !server.current;
                return (
                  <button
                    key={server.id}
                    type="button"
                    disabled={busy || server.current || unavailable}
                    onClick={() => void switchServer(server.id)}
                    aria-pressed={!!server.current}
                    className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-default ${
                      server.current
                        ? "border-violet-500 bg-violet-500/[0.06] dark:border-cyan-400 dark:bg-cyan-400/[0.06]"
                        : unavailable
                        ? "border-neutral-200 opacity-50 dark:border-white/10"
                        : "border-neutral-200 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-neutral-900 dark:text-white">{server.name}</span>
                      <span className="text-[11px] text-neutral-400 dark:text-white/35">
                        {server.current ? "текущий" : unavailable ? "нет мест" : "доступен"}
                      </span>
                    </span>
                    {server.region && (
                      <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-white/40">{server.region}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400 dark:text-white/30">
              При смене сервера включённый туннель сам переедет на новый узел.
            </p>
          </div>
        )}

        {/* ── Включение / выключение ──
            VPN-ONECLICK: скачивания файла-профиля больше нет. В приложении туннель
            поднимает и снимает сама оболочка; в браузере включать нечем, поэтому
            показываем, что подключение живёт в приложении. */}
        {ready && canTunnel && (
          active || tunnelConnecting || tunnelDisconnecting ? (
            <button
              type="button"
              disabled={busy || tunnelConnecting || tunnelDisconnecting}
              onClick={() => void disconnectTunnel()}
              className="mt-5 w-full rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/5"
            >
              {tunnelConnecting ? "Подключаем…" : tunnelDisconnecting ? "Выключаем…" : "Выключить соединение"}
            </button>
          ) : (
            <>
              <RoutingChoice value={routing} onChange={setRouting} disabled={busy} desktop={desktopShell} />
              <button
                type="button"
                disabled={busy || nodeIncomplete}
                onClick={() => void connect(routing)}
                className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400"
              >
                {busy ? "Включаем…" : "Включить соединение"}
              </button>
            </>
          )
        )}

        {/* Полный отзыв доступа — вторично: обычное «выключить» доступ не трогает. */}
        {state?.peer && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void revoke()}
            className="mt-3 w-full text-center text-[11px] text-neutral-400 underline-offset-2 transition hover:text-neutral-600 hover:underline disabled:opacity-50 dark:text-white/35 dark:hover:text-white/60"
          >
            Отключить и удалить доступ на этом аккаунте
          </button>
        )}
      </div>
    </div>
  );
}

export default function PremiumInfoModal({ isPremium, onClose, onOpenSettings }: { isPremium: boolean; onClose: () => void; onOpenSettings?: () => void }) {
  /* VPN-PLAN: раньше панель с тумблером открывалась только при isPremium,
     и подписчик «только VPN» видел витрину Premium — включить VPN было негде.

     Право на туннель считает сервер (Premium или подписка VPN, lib/vpn.ts)
     и возвращает его в поле entitled. Сессия о подписке VPN не знает ничего,
     поэтому спрашиваем сервер напрямую. При Premium запрос не нужен. */
  const [vpnEntitled, setVpnEntitled] = useState<boolean | null>(isPremium ? true : null);

  useEffect(() => {
    if (isPremium) return;
    let alive = true;
    fetch("/api/vpn/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive) setVpnEntitled(data?.entitled === true); })
      .catch(() => { if (alive) setVpnEntitled(false); });
    return () => { alive = false; };
  }, [isPremium]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md max-h-[88vh] overflow-y-auto rounded-3xl border border-neutral-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#111317]" onClick={(e) => e.stopPropagation()}>
        {vpnEntitled === null ? (
          /* Короткая пауза вместо мигания витриной: показать подписчику
              «купите Premium» и тут же заменить на тумблер хуже, чем подождать мгновение. */
          <div className="grid h-56 place-items-center text-sm text-neutral-400 dark:text-white/40">Проверяем доступ…</div>
        ) : vpnEntitled ? (
          <VpnPanel onClose={onClose} />
        ) : (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-500">TZ Premium</p>
              <h3 className="mt-1 text-xl font-semibold text-neutral-900 dark:text-white">Больше возможностей</h3>
            </div>
            <button onClick={onClose} className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-700 dark:hover:text-white" aria-label="Закрыть"><XIcon size={15} style={{ color: "inherit" }} /></button>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <span className="text-sm font-medium text-neutral-900 dark:text-white">Текущий тариф</span>
            <span className="rounded-full bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-500 dark:bg-white/10 dark:text-gray-400">
              Обычный аккаунт
            </span>
          </div>

          {/* Основное преимущество подписки */}
          <div className="mt-4 rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">{PREMIUM_MAIN_ADVANTAGE.badge}</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">{PREMIUM_MAIN_ADVANTAGE.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-gray-400">{PREMIUM_MAIN_ADVANTAGE.description}</p>
          </div>

          {/* 5 ключевых возможностей, которые преобладают в витрине */}
          <div className="mt-5">
            <p className="text-xs font-medium text-neutral-900 dark:text-white">Ключевые возможности</p>
            <ul className="mt-3 space-y-2.5">
              {PREMIUM_KEY_FEATURES.map((f) => (
                <li key={f.id} className="flex gap-3">
                  {/* Контурная иконка вместо эмодзи — единый стиль набора. */}
                  <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-500">
                    <PremiumFeatureIcon id={f.id} size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">{f.title}</p>
                    <p className="text-xs text-neutral-500 dark:text-gray-400">{f.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Подробности (сравнение тарифов) и подключение — в настройках профиля */}
          <div className="mt-6 space-y-2">
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                data-shell-hide="true"
                className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-4 py-2.5 text-sm font-semibold text-[#4a3200] shadow-[0_0_18px_rgba(240,190,60,0.35)] transition hover:opacity-90"
              >
                Подробнее и подключение
              </button>
            )}
            <p className="text-center text-[11px] text-neutral-400 dark:text-white/40">Сравнение тарифов и оплата — в настройках профиля → Premium.</p>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}