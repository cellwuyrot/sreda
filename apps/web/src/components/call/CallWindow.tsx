"use client";

import { useEffect, useRef, useState } from "react";
import { useCall } from "@/components/call/CallProvider";
import { callDuration } from "@/lib/callProtocol";

/**
 * CALL: окно вызова — входящего, исходящего и разговора.
 *
 * Одно окно на все три состояния, а не три разных: между «звонит» и «говорим»
 * переход должен быть без пересборки разметки, иначе в момент ответа картинка
 * моргает, а <video> теряет поток.
 *
 * Поверх всего и при любом разделе приложения: вызов нельзя «пролистать».
 */
export default function CallWindow() {
  const {
    state,
    accept,
    decline,
    hangup,
    micMuted,
    toggleMic,
    cameraOn,
    toggleCamera,
    flipCamera,
    facing,
    localStream,
    remoteStream,
    peerMuted,
    peerVideo,
  } = useCall();

  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [tick, setTick] = useState(0);

  /* Потоки привязываются в эффекте: srcObject — свойство элемента, его нельзя
     задать атрибутом в разметке. */
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
    /* Звук собеседника идёт через отдельный <audio>: в голосовом звонке видео-
       элемента без картинки может не быть в разметке, а слышать надо всегда. */
    if (audioRef.current) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  /* Секундный такт только на время разговора. */
  useEffect(() => {
    if (state.phase !== "active") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state.phase]);

  if (state.phase === "idle") return null;

  const { peer } = state;
  const showRemoteVideo = state.phase === "active" && peerVideo && remoteStream !== null;
  const status =
    state.phase === "incoming"
      ? state.video ? "Видеовызов" : "Вам звонят"
      : state.phase === "outgoing"
        ? "Гудок…"
        : state.startedAt
          ? callDuration(state.startedAt)
          : "Соединение…";

  return (
    <div
      className="fixed inset-0 z-[3000] flex flex-col items-center justify-between bg-[var(--cn-main,#12121c)] px-6 py-10 text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Звонок"
      data-tick={tick}
    >
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      {showRemoteVideo && (
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Собеседник */}
      <div className="relative z-10 mt-10 flex flex-col items-center gap-3 text-center">
        {peer.avatar ? (
          <img
            src={peer.avatar}
            alt=""
            className="h-28 w-28 rounded-full object-cover ring-2 ring-white/20"
          />
        ) : (
          <div className="grid h-28 w-28 place-items-center rounded-full bg-white/10 text-3xl font-semibold">
            {peer.userName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="text-2xl font-semibold">{peer.userName}</div>
        <div className="text-sm text-white/70">{status}</div>
        {state.phase === "active" && peerMuted && (
          <div className="text-xs text-amber-300">Микрофон собеседника выключен</div>
        )}
      </div>

      {/* Своё видео — маленькое окно в углу, как привычно в звонках. */}
      {cameraOn && (
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          /* scale-x-[-1] — переднюю камеру показываем зеркально, заднюю нет:
             человек ожидает видеть себя как в зеркале, а мир вокруг — как есть. */
          className={`absolute bottom-32 right-4 z-20 h-40 w-28 rounded-2xl border border-white/15 object-cover ${
            facing === "user" ? "scale-x-[-1]" : ""
          }`}
        />
      )}

      {/* Кнопки */}
      <div className="relative z-10 mb-4 flex w-full max-w-sm flex-col items-center gap-6">
        {state.phase === "active" && (
          <div className="flex items-center gap-4">
            <CallButton label={micMuted ? "Включить микрофон" : "Выключить микрофон"} active={!micMuted} onClick={toggleMic}>
              {micMuted ? "Звук выкл." : "Микрофон"}
            </CallButton>
            <CallButton label={cameraOn ? "Выключить камеру" : "Включить камеру"} active={cameraOn} onClick={toggleCamera}>
              {cameraOn ? "Камера" : "Камера выкл."}
            </CallButton>
            {/* Переворот показываем только при включённой камере: иначе кнопка ничего не делает. */}
            {cameraOn && (
              <CallButton label="Перевернуть камеру" active onClick={flipCamera}>
                {facing === "user" ? "Передняя" : "Задняя"}
              </CallButton>
            )}
          </div>
        )}

        {state.phase === "incoming" ? (
          <div className="flex w-full items-center justify-around">
            <button
              type="button"
              onClick={decline}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-sm font-semibold transition-colors hover:bg-red-500"
              aria-label="Отклонить"
            >
              ✕
            </button>
            <button
              type="button"
              onClick={accept}
              className="grid h-16 w-16 place-items-center rounded-full bg-emerald-600 text-sm font-semibold transition-colors hover:bg-emerald-500"
              aria-label="Ответить"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={hangup}
            className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-sm font-semibold transition-colors hover:bg-red-500"
            aria-label="Завершить звонок"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** Круглая кнопка управления медиа с подписью. */
function CallButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      /* min-h-[44px] — цель под палец: окно звонка живёт на телефоне. */
      className={`flex min-h-[44px] min-w-[72px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] transition-colors ${
        active ? "bg-white/15 text-white" : "bg-white/5 text-white/50"
      }`}
    >
      {children}
    </button>
  );
}
