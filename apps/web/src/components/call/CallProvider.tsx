"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useSession } from "next-auth/react";
import {
  CALL_CONNECT_TIMEOUT_MS,
  CALL_END_LABELS,
  type CallEndReason,
  type CallSignalKind,
} from "@/lib/callProtocol";
import { isAndroidShell } from "@/lib/shell";
import CallWindow from "@/components/call/CallWindow";

/**
 * CALL: личные звонки — только в приложении для телефона.
 *
 * ── Почему только apk ──────────────────────────────────────────────
 *
 * Звонок отличается от голосового канала одним свойством: его ждут СЕЙЧАС. Окно
 * вызова должно вспыхивать поверх блокировки на закрытом телефоне, а это умеет
 * только нативная оболочка (см. IncomingCallActivity в apps/android). В браузере и в
 * десктопе вызов можно было бы показать только во вкладке, которая открыта, —
 * то есть с вероятностью пропуска почти сто процентов. Ненадёжный звонок хуже
 * отсутствующего: на него начинают рассчитывать.
 *
 * Принимать вызов всё равно разрешено всем: если человек сейчас сидит за
 * компьютером, глушить входящий вызов было бы странно. Ограничено только
 * НАЧАЛО звонка — кнопка в профиле (см. `callSupported`).
 *
 * ── Почему свой сокет, а не голосовой ───────────────────────────────
 *
 * Голосовой слой живёт, пока человек в голосовом канале, а вызов может прийти в
 * любой момент и на любой странице приложения. Поэтому здесь отдельное
 * соединение — так же, как его держат колокольчик и список друзей.
 */

export interface CallPeer {
  userId: string;
  userName: string;
  avatar: string | null;
}

export type CallState =
  | { phase: "idle" }
  | {
      phase: "outgoing" | "incoming" | "active";
      callId: string;
      peer: CallPeer;
      video: boolean;
      /** Момент начала разговора — для счётчика длительности. */
      startedAt: number | null;
    };

interface CallContextValue {
  state: CallState;
  /** Кнопка звонка показывается только там, где звонок работает как звонок. */
  callSupported: boolean;
  /** Последняя причина завершения — показывается секунду после звонка. */
  lastEnd: string | null;
  startCall: (peer: CallPeer, video: boolean) => Promise<{ ok: boolean; error?: string }>;
  accept: () => void;
  decline: () => void;
  hangup: () => void;
  micMuted: boolean;
  toggleMic: () => void;
  cameraOn: boolean;
  toggleCamera: () => void;
  /** Передняя/задняя камера. */
  facing: "user" | "environment";
  flipCamera: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Собеседник выключил микрофон. */
  peerMuted: boolean;
  /** У собеседника включена камера. */
  peerVideo: boolean;
}

const CallContext = createContext<CallContextValue | null>(null);

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall вне CallProvider");
  return ctx;
}

/** Звук гудка/вызова. Собственный файл не заводим — берём уже есть в проекте. */
const RING_SOUND = "/sounds/connection.mp3";

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/voice/turn");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(data.iceServers) ? data.iceServers : [];
  } catch {
    /* Без перевалочного сервера звонок в одной сети всё равно соберётся. */
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [state, setState] = useState<CallState>({ phase: "idle" });
  const [lastEnd, setLastEnd] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerMuted, setPeerMuted] = useState(false);
  const [peerVideo, setPeerVideo] = useState(false);
  const [callSupported, setCallSupported] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const ringRef = useRef<HTMLAudioElement | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Кандидаты могут опередить договорённость: без очереди такой кандидат
     отбрасывается, и звонок собирается на секунды дольше или не собирается вовсе. */
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  /* Звонок НАЧИНАЕМ только в приложении для телефона. Проверка в эффекте, а не в
     теле компонента: на сервере нет navigator, и разметка первого рендера должна
     совпасть с серверной. */
  useEffect(() => {
    setCallSupported(isAndroidShell());
  }, []);

  const stopRing = useCallback(() => {
    const audio = ringRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, []);

  const teardown = useCallback(
    (reason?: CallEndReason | null) => {
      stopRing();
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      pcRef.current?.close();
      pcRef.current = null;
      pendingIceRef.current = [];
      /* Дорожки останавливаются явно: иначе после звонка остаётся гореть
         индикатор камеры — самый пугающий вид недоработки, какой бывает. */
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      callIdRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setMicMuted(false);
      setCameraOn(false);
      setPeerMuted(false);
      setPeerVideo(false);
      setState({ phase: "idle" });
      if (reason) setLastEnd(CALL_END_LABELS[reason] ?? "Звонок завершён");
    },
    [stopRing],
  );

  /** Захват микрофона (и камеры, если звонок с видео). */
  const capture = useCallback(async (video: boolean, side: "user" | "environment") => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: side, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    localRef.current = stream;
    setLocalStream(stream);
    setCameraOn(video);
    return stream;
  }, []);

  const signal = useCallback((kind: CallSignalKind, payload: unknown) => {
    const callId = callIdRef.current;
    if (!callId) return;
    socketRef.current?.emit("call-signal", { callId, kind, payload });
  }, []);

  /** Собрать медиа-соединение и повесить обработчики. */
  const buildPeer = useCallback(
    async (stream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers: await iceServers() });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate) signal("ice", event.candidate.toJSON());
      };
      pc.ontrack = (event) => {
        const [incoming] = event.streams;
        if (incoming) {
          setRemoteStream(incoming);
          setPeerVideo(incoming.getVideoTracks().some((t) => t.enabled));
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          stopRing();
          setState((prev) =>
            prev.phase === "idle" ? prev : { ...prev, phase: "active", startedAt: prev.startedAt ?? Date.now() },
          );
        }
        /* «failed» — окончательный провал; «disconnected» бывает временным при смене
           сети и сам восстанавливается — его не трогаем. */
        if (pc.connectionState === "failed") {
          socketRef.current?.emit("call-hangup", { callId: callIdRef.current });
          teardown("failed");
        }
      };
      return pc;
    },
    [signal, stopRing, teardown],
  );

  /* ── Соединение и события вызова ────────────────────────────── */
  useEffect(() => {
    if (!session?.user) return;
    const socket = io({ path: "/api/socketio", withCredentials: true });
    socketRef.current = socket;
    ringRef.current = Object.assign(new Audio(RING_SOUND), { loop: true, preload: "auto" as const });

    socket.on(
      "call-incoming",
      ({ callId, from, video }: { callId: string; from: CallPeer; video: boolean }) => {
        /* Уже в звонке — сервер такой вызов не пропустит, но событие может
           прилететь вторым устройством раньше, чем придёт call-taken. */
        if (callIdRef.current) return;
        callIdRef.current = callId;
        setLastEnd(null);
        setState({ phase: "incoming", callId, peer: from, video, startedAt: null });
        void ringRef.current?.play().catch(() => null);
      },
    );

    /* Трубку взяли на другом устройстве — здесь просто перестаём звенеть. */
    socket.on("call-taken", ({ callId }: { callId: string }) => {
      if (callIdRef.current !== callId) return;
      if (pcRef.current) return;
      teardown(null);
    });

    socket.on("call-ended", ({ callId, reason }: { callId: string; reason: CallEndReason }) => {
      if (callIdRef.current !== callId) return;
      teardown(reason);
    });

    socket.on("call-media", ({ muted, video }: { muted: boolean; video: boolean }) => {
      setPeerMuted(muted);
      setPeerVideo(video);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.user, teardown]);

  /* ── Договорённость о медиа ─────────────────────────────────

     Предложение всегда делает ЗВОНЯЩИЙ, и только после ответа. До ответа медиа
     не текут вовсе: иначе звонящий слышал бы комнату того, кто трубку ещё не взял. */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onAccepted = async ({ callId }: { callId: string }) => {
      if (callIdRef.current !== callId) return;
      stopRing();
      /* Принявшая сторона ждёт предложение, а не создаёт его. */
      if (state.phase !== "outgoing") {
        setState((prev) => (prev.phase === "idle" ? prev : { ...prev, phase: "active", startedAt: Date.now() }));
        return;
      }
      const stream = localRef.current;
      if (!stream) return;
      const pc = await buildPeer(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal("offer", offer);
      setState((prev) => (prev.phase === "idle" ? prev : { ...prev, phase: "active", startedAt: Date.now() }));
      connectTimerRef.current = setTimeout(() => {
        if (pcRef.current?.connectionState !== "connected") {
          socket.emit("call-hangup", { callId });
          teardown("failed");
        }
      }, CALL_CONNECT_TIMEOUT_MS);
    };

    const onSignal = async ({
      callId,
      kind,
      payload,
    }: {
      callId: string;
      kind: CallSignalKind;
      payload: unknown;
    }) => {
      if (callIdRef.current !== callId) return;

      if (kind === "offer") {
        const stream = localRef.current;
        if (!stream) return;
        const pc = pcRef.current ?? (await buildPeer(stream));
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        /* Отложенные кандидаты добавляются только ПОСЛЕ описания стороны. */
        for (const candidate of pendingIceRef.current.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => null);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal("answer", answer);
        return;
      }

      if (kind === "answer") {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit).catch(() => null);
        for (const candidate of pendingIceRef.current.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => null);
        }
        return;
      }

      if (kind === "ice") {
        const pc = pcRef.current;
        const candidate = payload as RTCIceCandidateInit;
        if (!pc || !pc.remoteDescription) {
          pendingIceRef.current.push(candidate);
          return;
        }
        await pc.addIceCandidate(candidate).catch(() => null);
      }
    };

    socket.on("call-accepted", onAccepted);
    socket.on("call-signal", onSignal);
    return () => {
      socket.off("call-accepted", onAccepted);
      socket.off("call-signal", onSignal);
    };
  }, [buildPeer, signal, state.phase, stopRing, teardown]);

  /* ── Действия ──────────────────────────────────────────── */
  const startCall = useCallback(
    async (peer: CallPeer, video: boolean) => {
      const socket = socketRef.current;
      if (!socket) return { ok: false, error: "Нет связи с сервером" };
      if (state.phase !== "idle") return { ok: false, error: "Звонок уже идёт" };

      /* Разрешение спрашиваем ДО вызова: если микрофон запретят, второй
         человек не должен узнать об этом звонке вообще. */
      try {
        await capture(video, facing);
      } catch {
        return { ok: false, error: "Нет доступа к микрофону или камере" };
      }

      return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        socket.emit(
          "call-invite",
          { toUserId: peer.userId, video },
          (result: { ok: boolean; callId?: string; error?: string }) => {
            if (!result?.ok || !result.callId) {
              teardown(null);
              resolve({ ok: false, error: result?.error ?? "Звонок недоступен" });
              return;
            }
            callIdRef.current = result.callId;
            setLastEnd(null);
            setState({ phase: "outgoing", callId: result.callId, peer, video, startedAt: null });
            void ringRef.current?.play().catch(() => null);
            resolve({ ok: true });
          },
        );
      });
    },
    [capture, facing, state.phase, teardown],
  );

  const accept = useCallback(() => {
    const callId = callIdRef.current;
    if (!callId || state.phase !== "incoming") return;
    stopRing();
    void (async () => {
      try {
        const stream = await capture(state.video, facing);
        await buildPeer(stream);
      } catch {
        socketRef.current?.emit("call-decline", { callId });
        teardown(null);
        return;
      }
      socketRef.current?.emit("call-accept", { callId });
      setState((prev) => (prev.phase === "idle" ? prev : { ...prev, phase: "active", startedAt: Date.now() }));
    })();
  }, [buildPeer, capture, facing, state, stopRing, teardown]);

  const decline = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) socketRef.current?.emit("call-decline", { callId });
    teardown(null);
  }, [teardown]);

  const hangup = useCallback(() => {
    const callId = callIdRef.current;
    if (callId) socketRef.current?.emit("call-hangup", { callId });
    teardown(null);
  }, [teardown]);

  const notifyMedia = useCallback((muted: boolean, video: boolean) => {
    const callId = callIdRef.current;
    if (callId) socketRef.current?.emit("call-media", { callId, muted, video });
  }, []);

  const toggleMic = useCallback(() => {
    const stream = localRef.current;
    if (!stream) return;
    const next = !micMuted;
    /* Дорожка глушится, а не останавливается: остановка потребовала бы новой
       договорённости при включении обратно — с паузой в секунду посреди разговора. */
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMicMuted(next);
    notifyMedia(next, cameraOn);
  }, [cameraOn, micMuted, notifyMedia]);

  const toggleCamera = useCallback(() => {
    void (async () => {
      const pc = pcRef.current;
      const stream = localRef.current;
      if (!stream) return;

      if (cameraOn) {
        stream.getVideoTracks().forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
        setCameraOn(false);
        notifyMedia(micMuted, false);
        return;
      }

      try {
        const extra = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = extra.getVideoTracks()[0];
        if (!track) return;
        stream.addTrack(track);
        /* Если отправитель видео уже есть — подменяем дорожку без новой
           договорённости; если нет — добавляем и передогавариваемся. */
        const sender = pc?.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(track);
        } else if (pc) {
          pc.addTrack(track, stream);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signal("offer", offer);
        }
        setLocalStream(stream);
        setCameraOn(true);
        notifyMedia(micMuted, true);
      } catch {
        /* Камеру заняло другое приложение или запретили доступ — звонок без видео
           продолжается как обычный голосовой. */
      }
    })();
  }, [cameraOn, facing, micMuted, notifyMedia, signal]);

  const flipCamera = useCallback(() => {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    if (!cameraOn) return;
    void (async () => {
      const stream = localRef.current;
      const pc = pcRef.current;
      if (!stream) return;
      try {
        /* Старая дорожка останавливается ДО запроса новой: большинство телефонов
           не умеют держать обе камеры одновременно, и запрос второй без остановки
           первой просто падает. */
        stream.getVideoTracks().forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
        const extra = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = extra.getVideoTracks()[0];
        if (!track) return;
        stream.addTrack(track);
        const sender = pc?.getSenders().find((s) => s.track?.kind === "video" || s.track === null);
        if (sender) await sender.replaceTrack(track);
        setLocalStream(stream);
      } catch {
        setCameraOn(false);
        notifyMedia(micMuted, false);
      }
    })();
  }, [cameraOn, facing, micMuted, notifyMedia]);

  const value = useMemo<CallContextValue>(
    () => ({
      state,
      callSupported,
      lastEnd,
      startCall,
      accept,
      decline,
      hangup,
      micMuted,
      toggleMic,
      cameraOn,
      toggleCamera,
      facing,
      flipCamera,
      localStream,
      remoteStream,
      peerMuted,
      peerVideo,
    }),
    [
      accept,
      callSupported,
      cameraOn,
      decline,
      facing,
      flipCamera,
      hangup,
      lastEnd,
      localStream,
      micMuted,
      peerMuted,
      peerVideo,
      remoteStream,
      startCall,
      state,
      toggleCamera,
      toggleMic,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallWindow />
    </CallContext.Provider>
  );
}
