"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { baseMimeType } from "@/lib/mediaNote";

interface VoiceRecorderProps {
  onRecorded: (blob: Blob, duration: number) => void;
  disabled?: boolean;
}

export default function VoiceRecorder({ onRecorded, disabled }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);

        const duration = (Date.now() - startTimeRef.current) / 1000;
        if (chunksRef.current.length > 0 && duration >= 0.5) {
          /* Тип БЕЗ кодеков. `mimeType` здесь — «audio/webm;codecs=opus», и
             именно эта строка уходила на сервер как Content-Type части запроса,
             а он сверял её со списком разрешённых точным равенством и отвечал
             415. То есть голосовое молча не отправлялось (клиент ошибку не
             показывал). Сервер теперь режет параметры сам, но отправлять чистый
             тип правильно и здесь: он попадает во вложение сообщения. */
          const blob = new Blob(chunksRef.current, { type: baseMimeType(mimeType) });
          onRecorded(blob, Math.round(duration));
        }
        setRecording(false);
        setElapsed(0);
      };

      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start(250);
      setRecording(true);

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch {
      // Microphone denied
    }
  }, [onRecorded]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    chunksRef.current = [];
    startTimeRef.current = Date.now();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setRecording(false);
    setElapsed(0);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (recording) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={cancelRecording}
          className="p-2 text-red-400 hover:text-red-500 transition-colors"
          title="Отменить"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-2 flex-1 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800/30">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm text-red-600 dark:text-red-400 font-mono">{formatTime(elapsed)}</span>
          <span className="text-xs text-red-400">Запись...</span>
        </div>
        <button
          type="button"
          onClick={stopRecording}
          className="p-2.5 bg-violet-500 dark:bg-cyan-600 text-white rounded-xl hover:opacity-90 transition-opacity"
          title="Отправить"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      className="p-2.5 text-neutral-400 hover:text-violet-500 dark:hover:text-cyan-400 transition-colors disabled:opacity-50"
      title="Голосовое сообщение"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m14 0a7 7 0 00-14 0m14 0v1a7 7 0 01-14 0v-1m7 8v4m-4 0h8" />
      </svg>
    </button>
  );
}
