"use client";

/**
 * Индикатор «печатает…» для каналов групп и личных чатов.
 * Работает поверх УЖЕ существующих серверных событий (apps/web/server.ts):
 *   каналы: emit "typing"/"stop-typing"  → приходят "user-typing"/"user-stop-typing"
 *   ЛС:     emit "dm-typing"/"dm-stop-typing" (+ "join-dm-conv") → "dm-typing"/"dm-stop-typing"
 * Никаких изменений на сервере не требуется.
 *
 * Экспортируется:
 *   useTypingEmitter — троттлированная отправка «я печатаю» (вызывать в onChange,
 *                      stopTyping() — при отправке сообщения);
 *   useTypingUsers   — список имён, кто сейчас печатает;
 *   TypingIndicator  — готовый компонент с точками (стили .tz-typing в globals.css).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

export type TypingTarget =
  | { kind: "channel"; channelId: string }
  | { kind: "dm"; convId: string };

const THROTTLE_MS = 2000;   // не чаще одного "typing" раз в 2 c
const IDLE_STOP_MS = 3500;  // авто-"stop-typing", если перестали печатать
const TTL_MS = 6000;        // страховка: имя исчезает, даже если stop потерялся

const targetKey = (t: TypingTarget) =>
  t.kind === "channel" ? `c:${t.channelId}` : `d:${t.convId}`;

/** Отправка «я печатаю» с троттлингом и авто-стопом. */
export function useTypingEmitter(
  socket: Socket | null | undefined,
  target: TypingTarget,
) {
  const socketRef = useRef(socket);
  const targetRef = useRef(target);
  useEffect(() => {
    socketRef.current = socket;
    targetRef.current = target;
  });

  const lastSent = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
    lastSent.current = 0;
    const s = socketRef.current;
    const t = targetRef.current;
    if (!s) return;
    if (t.kind === "channel") s.emit("stop-typing", { channelId: t.channelId });
    else s.emit("dm-stop-typing", { convId: t.convId });
  }, []);

  const emitTyping = useCallback(() => {
    const s = socketRef.current;
    const t = targetRef.current;
    if (!s) return;
    const now = Date.now();
    if (now - lastSent.current > THROTTLE_MS) {
      lastSent.current = now;
      if (t.kind === "channel") s.emit("typing", { channelId: t.channelId });
      else s.emit("dm-typing", { convId: t.convId });
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stopTyping, IDLE_STOP_MS);
  }, [stopTyping]);

  // При размонтировании честно говорим «перестал печатать».
  useEffect(() => () => stopTyping(), [stopTyping]);

  return { emitTyping, stopTyping };
}

/** Кто сейчас печатает (кроме самого пользователя). */
export function useTypingUsers(
  socket: Socket | null | undefined,
  target: TypingTarget,
  selfUserId?: string,
): string[] {
  const [typing, setTyping] = useState<Map<string, { name: string; until: number }>>(
    () => new Map(),
  );
  const key = targetKey(target);

  useEffect(() => {
    if (!socket) return;
    const t = target;

    const add = (userId: string, userName?: string) => {
      if (!userId || userId === selfUserId) return;
      setTyping((prev) => {
        const next = new Map(prev);
        next.set(userId, { name: userName || "Кто-то", until: Date.now() + TTL_MS });
        return next;
      });
    };
    const remove = (userId: string) => {
      setTyping((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    };

    let onTyping: (p: { userId: string; userName?: string; channelId?: string }) => void;
    let onStop: (p: { userId: string }) => void;

    if (t.kind === "channel") {
      onTyping = (p) => {
        if (p.channelId && p.channelId !== t.channelId) return;
        add(p.userId, p.userName);
      };
      onStop = (p) => remove(p.userId);
      socket.on("user-typing", onTyping);
      socket.on("user-stop-typing", onStop);
    } else {
      // Комната беседы нужна, чтобы события typing были видны только участникам.
      socket.emit("join-dm-conv", { convId: t.convId });
      onTyping = (p) => add(p.userId, p.userName);
      onStop = (p) => remove(p.userId);
      socket.on("dm-typing", onTyping);
      socket.on("dm-stop-typing", onStop);
    }

    // Страховочная чистка «протухших» имён.
    const pruner = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, v] of next) {
          if (v.until < now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      clearInterval(pruner);
      if (t.kind === "channel") {
        socket.off("user-typing", onTyping);
        socket.off("user-stop-typing", onStop);
      } else {
        socket.off("dm-typing", onTyping);
        socket.off("dm-stop-typing", onStop);
        socket.emit("leave-dm-conv", { convId: t.convId });
      }
      setTyping(new Map());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, key, selfUserId]);

  return Array.from(typing.values()).map((v) => v.name);
}

/** Готовый индикатор. Рендерите над полем ввода. */
export default function TypingIndicator({
  socket,
  target,
  selfUserId,
}: {
  socket: Socket | null | undefined;
  target: TypingTarget;
  selfUserId?: string;
}) {
  const names = useTypingUsers(socket, target, selfUserId);

  let label = "";
  if (names.length === 1) label = `${names[0]} печатает`;
  else if (names.length === 2) label = `${names[0]} и ${names[1]} печатают`;
  else if (names.length > 2) label = "Несколько человек печатают";

  // min-height в .tz-typing резервирует место — вёрстка не прыгает.
  return (
    <div className="tz-typing" aria-live="polite">
      {names.length > 0 && (
        <>
          <span className="tz-typing-dots" aria-hidden>
            <span className="tz-typing-dot" />
            <span className="tz-typing-dot" />
            <span className="tz-typing-dot" />
          </span>
          <span>{label}…</span>
        </>
      )}
    </div>
  );
}
