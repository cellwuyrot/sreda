"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { baseMimeType } from "@/lib/mediaNote";
import RecordingWaveform from "./RecordingWaveform";

interface VoiceRecorderProps {
  onRecorded: (blob: Blob, duration: number) => void;
  disabled?: boolean;
}

export default function VoiceRecorder({ onRecorded, disabled }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ blob: Blob; duration: number; url: string } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelled.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (pending.current || recorderRef.current) return;
    pending.current = true;
    cancelled.current = false;
    setError("");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || cancelled.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const started = Date.now();
      const capturedStream = stream;
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        capturedStream.getTracks().forEach(t => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        recorderRef.current = null;
        const duration = (Date.now() - started) / 1000;
        if (mounted.current && !cancelled.current && chunks.length && duration >= 0.5) {
          const blob = new Blob(chunks, { type: baseMimeType(recorder.mimeType || mimeType || "audio/webm") });
          setReview({ blob, duration: Math.round(duration), url: URL.createObjectURL(blob) });
        }
        if (mounted.current) {
          if (!cancelled.current && (!chunks.length || duration < 0.5)) setError("Запись слишком короткая. Попробуйте ещё раз.");
          setRecording(false); setRecordingStream(null); setElapsed(0);
        }
      };
      recorder.onerror = () => { cancelled.current = true; if (mounted.current) setError("Ошибка записи. Проверьте микрофон."); };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecordingStream(stream);
      setRecording(true);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    } catch {
      stream?.getTracks().forEach(t => t.stop());
      recorderRef.current = null;
      if (mounted.current) setError("Не удалось начать запись. Проверьте доступ к микрофону.");
    } finally { pending.current = false; }
  }, []);

  const stopRecording = useCallback((cancel: boolean) => {
    if (cancel) cancelled.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);
  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  if (review) return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-cyan-400/20 bg-slate-900 p-2">
      <audio controls preload="metadata" src={review.url} aria-label="Прослушать голосовое сообщение" className="h-9 max-w-full" />
      <button type="button" onClick={() => setReview(null)} className="rounded-xl px-3 py-2 text-sm text-neutral-300 hover:text-red-400">Удалить</button>
      <button type="button" disabled={disabled} onClick={() => { const take = review; setReview(null); onRecorded(take.blob, take.duration); }} className="rounded-xl bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">Отправить</button>
    </div>
  );
  if (recording) return (
    <div className="tz-micro-enter flex min-w-0 items-center gap-2 rounded-2xl border border-cyan-400/20 bg-slate-900 px-2 py-1.5">
      <button type="button" onClick={() => stopRecording(true)} aria-label="Отменить запись" title="Отменить" className="rounded-xl px-2 py-1.5 text-neutral-400 hover:text-red-400 focus-visible:outline focus-visible:outline-cyan-400">✕</button>
      <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
      {recordingStream && <RecordingWaveform stream={recordingStream} />}
      <span className="text-sm text-white tabular-nums" aria-label={`Запись ${time}`}>{time}</span>
      <span className="hidden sm:inline text-xs text-neutral-400">Запись голосового сообщения</span>
      <button type="button" onClick={() => stopRecording(false)} aria-label="Остановить запись" title="Остановить запись" className="ml-auto rounded-xl bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 focus-visible:outline focus-visible:outline-white">Готово</button>
    </div>
  );
  return <div className="flex items-center gap-1"><button type="button" onClick={startRecording} disabled={disabled} aria-label="Записать голосовое сообщение" title="Голосовое сообщение" className="p-2.5 text-neutral-400 hover:text-cyan-400 transition-colors motion-reduce:transition-none disabled:opacity-50"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a3 3 0 00-3 3v5a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3m-4 0h8" /></svg></button>{error && <span role="alert" className="text-xs text-red-400">{error}</span>}</div>;
}
