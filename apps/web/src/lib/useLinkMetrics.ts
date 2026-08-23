"use client";

/**
 * FIX-LINKSTATS: живые показатели канала для окна соединения.
 *
 * Зачем. Окно говорило только «соединение активно», а это не отвечает на
 * единственный вопрос, ради которого человек туда заходит: не стало ли хуже со
 * включённым туннелем. При скачке задержки человек винит мессенджер, а не VPN,
 * и выключатель без цифр ему в этом никак не помогает.
 *
 * Почему задержка мерится сама, а скорость — только по кнопке. Пинг — это пустой
 * ответ без тела, его можно спрашивать раз в пять секунд бесконечно. Замер скорости —
 * это несколько мегабайт за раз, и автоматический замер каждые пять секунд съедал бы
 * тот самый лимит трафика, который показан строкой выше в том же окне.
 *
 * Почему берётся МИНИМУМ из последних замеров, а не последний. Одиночный замер
 * ловит случайные всплески — сборка мусора в браузере, занятую сеть — и цифра
 * прыгала бы на сотни миллисекунд на ровном канале.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const PROBE_URL = "/api/vpn/ping";
/** Как часто спрашиваем задержку и сколько ждём один ответ. */
const PROBE_EVERY_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;
/** Сколько замеров держим для сглаживания. */
const PROBE_KEEP = 4;
/** Размер балласта для замера скорости и потолок ожидания. */
const SPEED_BYTES = 3_000_000;
const SPEED_TIMEOUT_MS = 20_000;

export interface LinkMetrics {
  /** Задержка до сайта в миллисекундах; null — ещё не знаем. */
  pingMs: number | null;
  /** Последний замер не дошёл — связи нет. */
  lost: boolean;
  /** Скорость скачивания, Мбит/с; null — ещё не мерили. */
  speedMbits: number | null;
  speedBusy: boolean;
  speedError: string;
  /** Запустить замер скорости вручную. */
  measureSpeed: () => Promise<void>;
}

/** Запрос с потолком по времени: без него висящий fetch живёт минутами. */
function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

export function useLinkMetrics(enabled: boolean): LinkMetrics {
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [lost, setLost] = useState(false);
  const [speedMbits, setSpeedMbits] = useState<number | null>(null);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [speedError, setSpeedError] = useState("");
  const history = useRef<number[]>([]);

  /* Выключили туннель — прежние цифры больше не о чём: они относятся
     к другому маршруту. Оставленные на экране, они врут. */
  useEffect(() => {
    if (enabled) return;
    history.current = [];
    setPingMs(null);
    setLost(false);
    setSpeedMbits(null);
    setSpeedError("");
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const probe = async () => {
      const { signal, done } = withTimeout(PROBE_TIMEOUT_MS);
      const started = performance.now();
      try {
        const res = await fetch(`${PROBE_URL}?t=${Date.now()}`, { cache: "no-store", signal });
        if (cancelled) return;
        if (!res.ok && res.status !== 204) throw new Error(String(res.status));
        const rtt = Math.round(performance.now() - started);
        const next = [...history.current, rtt].slice(-PROBE_KEEP);
        history.current = next;
        setPingMs(Math.min(...next));
        setLost(false);
      } catch {
        if (cancelled) return;
        /* Один промах — ещё не потеря связи, но и врать прежним числом нельзя. */
        history.current = [];
        setPingMs(null);
        setLost(true);
      } finally {
        done();
      }
    };

    void probe();
    const timer = setInterval(() => void probe(), PROBE_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  const measureSpeed = useCallback(async () => {
    if (speedBusy) return;
    setSpeedBusy(true);
    setSpeedError("");
    const { signal, done } = withTimeout(SPEED_TIMEOUT_MS);
    try {
      const started = performance.now();
      const res = await fetch(`${PROBE_URL}?size=${SPEED_BYTES}&t=${Date.now()}`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      /* Считаем ФАКТИЧЕСКИ пришедшие байты, а не заказанный размер:
         ответ мог оборваться, и тогда скорость оказалась бы завышена. */
      const buf = await res.arrayBuffer();
      const seconds = (performance.now() - started) / 1000;
      if (seconds <= 0 || buf.byteLength <= 0) throw new Error("empty");
      setSpeedMbits(Math.round(((buf.byteLength * 8) / 1_000_000 / seconds) * 10) / 10);
    } catch {
      setSpeedError("Замер не удался");
      setSpeedMbits(null);
    } finally {
      done();
      setSpeedBusy(false);
    }
  }, [speedBusy]);

  return { pingMs, lost, speedMbits, speedBusy, speedError, measureSpeed };
}
