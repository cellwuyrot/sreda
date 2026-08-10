"use client";

// FIX-OVL: Discord-подобный оверлей голосового чата для десктоп-приложения.
// Компонент ничего не рисует: он раз в секунду (и сразу при изменениях) передаёт
// состояние голосового канала — участники, кто говорит, статус микрофона/звука,
// превью демонстрации экрана — в Electron-оболочку, которая показывает компактный
// оверлей поверх других окон, когда TrioZ не в фокусе. В обычном браузере
// компонент — no-op.

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useVoice } from "@/contexts/VoiceContext";
import { getDesktopApi } from "@/lib/desktop";

const PUSH_INTERVAL_MS = 1000;
const THUMB_WIDTH = 272;

const EMPTY_STATE = { inVoice: false as const, channelName: null, users: [], screenThumb: null, sharerName: null };

export default function VoiceOverlayBridge() {
  const voice = useVoice();
  const { data: session } = useSession();
  const myUserId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { isConnected, channelName, users, speakingUsers, isMuted, isDeafened } = voice;
  const activeShare = voice.screenShares[0] ?? null;

  // Держим последнюю демонстрацию в ref, чтобы основной эффект не перезапускался
  // на каждый рендер провайдера (массив screenShares пересоздаётся часто).
  // Синхронизируем ref в эффекте (не в рендере) — требование react-hooks/refs.
  const activeShareRef = useRef(activeShare);
  useEffect(() => {
    activeShareRef.current = activeShare;
  }, [activeShare]);
  const shareKey = activeShare ? `${activeShare.socketId}:${activeShare.userName}` : "";

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.sendVoiceOverlayState) return;

    if (!isConnected) {
      api.sendVoiceOverlayState(EMPTY_STATE);
      return;
    }

    const captureThumb = (): string | null => {
      const share = activeShareRef.current;
      if (!share) return null;
      try {
        let video = videoRef.current;
        if (!video) {
          video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          videoRef.current = video;
        }
        if (video.srcObject !== share.stream) {
          video.srcObject = share.stream;
          void video.play().catch(() => {});
        }
        if (!video.videoWidth || !video.videoHeight) return null;
        let canvas = canvasRef.current;
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvasRef.current = canvas;
        }
        const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * THUMB_WIDTH));
        canvas.width = THUMB_WIDTH;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, THUMB_WIDTH, h);
        return canvas.toDataURL("image/jpeg", 0.55);
      } catch {
        return null;
      }
    };

    const push = () => {
      const share = activeShareRef.current;
      api.sendVoiceOverlayState?.({
        inVoice: true,
        channelName,
        users: users.map((u) => {
          // Для себя берём достоверные локальные флаги (isMuted/isDeafened):
          // собственный `muted` в списке участников не обновляется по WebRTC,
          // а deafen вообще не рассылается по сети — он известен только клиенту.
          const self = !!myUserId && u.userId === myUserId;
          return {
            id: u.socketId,
            name: u.userName,
            speaking: speakingUsers.has(u.socketId),
            muted: self ? isMuted : u.muted,
            deafened: self ? isDeafened : false,
            self,
          };
        }),
        screenThumb: captureThumb(),
        sharerName: share ? share.userName : null,
      });
    };

    push();
    const timer = setInterval(push, PUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isConnected, channelName, users, speakingUsers, isMuted, isDeafened, myUserId, shareKey]);

  // При размонтировании гарантированно скрываем оверлей.
  useEffect(
    () => () => {
      getDesktopApi()?.sendVoiceOverlayState?.(EMPTY_STATE);
    },
    [],
  );

  return null;
}
