"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface VoicePlayerProps {
  url: string;
  duration?: number;
  isOwn?: boolean;
  e2eeIv?: string;
  e2eeDecrypt?: (encrypted: ArrayBuffer, iv: string) => Promise<ArrayBuffer>;
}

export default function VoicePlayer({ url, duration: initialDuration, isOwn, e2eeIv, e2eeDecrypt }: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [error, setError] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // FIX-SEEK: флаг готовности — audio.readyState >= 2 (HAVE_CURRENT_DATA)
  const [canSeek, setCanSeek] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // FIX-SEEK: objectURL для зашифрованных сообщений — убираем при размонтировании
  const objectUrlRef = useRef<string | null>(null);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    const audio = audioRef.current;
    if (audio) {
      audio.volume = v;
      audio.muted = v === 0;
    }
    setMuted(v === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (muted || volume === 0) {
      const restore = volume === 0 ? 1 : volume;
      audio.muted = false;
      audio.volume = restore;
      setVolume(restore);
      setMuted(false);
    } else {
      audio.muted = true;
      setMuted(true);
    }
  }, [muted, volume]);

  useEffect(() => {
    let cancelled = false;

    // FIX-CRASH: очищаем предыдущий objectURL перед созданием нового
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (e2eeIv && e2eeDecrypt) {
      setDecrypting(true);
      setCanSeek(false);
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(buf => e2eeDecrypt(buf, e2eeIv))
        .then(decrypted => {
          if (cancelled) return;
          const blob = new Blob([decrypted], { type: "audio/webm" });
          const objUrl = URL.createObjectURL(blob);
          objectUrlRef.current = objUrl;
          const audio = new Audio(objUrl);
          setupAudio(audio);
          setDecrypting(false);
        })
        .catch(() => { if (!cancelled) { setError(true); setDecrypting(false); } });
      return () => {
        cancelled = true;
        if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
      };
    }

    const audio = new Audio();
    // FIX-SEEK: preload=auto чтобы браузер загружал аудио и позволял перемотку
    audio.preload = "auto";
    audio.src = url;
    setupAudio(audio);
    return () => {
      cancelled = true;
      audio.pause();
      audio.src = "";
    };

    function setupAudio(a: HTMLAudioElement) {
      // FIX-SEEK: preload=auto нужен и для зашифрованных (blob URL)
      a.preload = "auto";
      audioRef.current = a;
      setError(false);
      setCanSeek(false);
      setProgress(0);
      setCurrentTime(0);

      // FIX-SEEK: canplay/canplaythrough — аудио готово к воспроизведению и перемотке
      a.oncanplay = () => { if (!cancelled) setCanSeek(true); };
      a.oncanplaythrough = () => { if (!cancelled) setCanSeek(true); };

      a.onloadedmetadata = () => {
        if (cancelled) return;
        if (a.duration && isFinite(a.duration)) {
          setDuration(Math.round(a.duration));
        }
      };

      // FIX-SEEK: loadeddata даёт длительность раньше, чем metaonly в некоторых форматах
      a.onloadeddata = () => {
        if (cancelled) return;
        if (a.duration && isFinite(a.duration)) setDuration(Math.round(a.duration));
        setCanSeek(true);
      };

      a.ontimeupdate = () => {
        if (cancelled) return;
        if (a.duration && isFinite(a.duration)) {
          setProgress(a.currentTime / a.duration);
        }
        setCurrentTime(a.currentTime);
      };

      a.onended = () => {
        if (cancelled) return;
        setPlaying(false);
        setProgress(0);
        setCurrentTime(0);
      };

      // FIX-CRASH: при ошибке показываем кнопку «Retry» вместо падения
      a.onerror = () => {
        if (cancelled) return;
        setError(true);
        setPlaying(false);
        setCanSeek(false);
      };
    }
  }, [url, e2eeIv, e2eeDecrypt]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (error) {
      // FIX-CRASH: повторная попытка воспроизведения
      setError(false);
      audio.load();
      audio.play().catch(() => setError(true));
      setPlaying(true);
      return;
    }
    if (audio.paused) {
      // FIX-CRASH: явный load перед play исправляет ошибку «не могу воспроизвести
      // источник» в Safari и некоторых версиях Chrome при первом нажатии
      if (audio.readyState === 0) audio.load();
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch((e: Error) => {
          // AbortError — пользователь быстро нажал стоп; не считается ошибкой
          if (e.name !== "AbortError") setError(true);
          setPlaying(false);
        });
      }
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [error]);

  // FIX-SEEK: перемотка по клику и по drag на полосе прогресса
  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    // FIX-SEEK: ждём, пока браузер загрузит хотя бы текущие данные
    if (!audio.duration || !isFinite(audio.duration)) return;
    if (audio.readyState < 2) {
      // Аудио не готово — подождём canplay и тогда применим перемотку
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetTime = ratio * audio.duration;
      const apply = () => {
        audio.currentTime = targetTime;
        setProgress(ratio);
        setCurrentTime(targetTime);
        audio.removeEventListener("canplay", apply);
      };
      audio.addEventListener("canplay", apply, { once: true });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    try {
      audio.currentTime = ratio * audio.duration;
      setProgress(ratio);
      setCurrentTime(audio.currentTime);
    } catch { /* игнорируем: браузер не готов к seek */ }
  }, []);

  const formatTime = (s: number) => {
    const sec = Math.max(0, Math.floor(s));
    const m = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] max-w-[320px]">
      <button
        onClick={toggle}
        disabled={decrypting}
        className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
          decrypting
            ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-500 animate-pulse"
            : error
              ? "bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 dark:hover:bg-red-900/50"
              : isOwn
                ? "bg-white/20 hover:bg-white/30 text-white"
                : "bg-violet-100 dark:bg-cyan-400/20 hover:bg-violet-200 dark:hover:bg-cyan-400/30 text-accent"
        }`}
        title={error ? "Ошибка — нажмите для повтора" : undefined}
      >
        {decrypting ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
          </svg>
        ) : error ? (
          // FIX-CRASH: иконка повтора при ошибке (вместо пустой кнопки)
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : playing ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        {/* FIX-SEEK: курсор pointer всегда, чтобы было понятно что полоса кликабельна */}
        <div
          className={`h-1.5 rounded-full cursor-pointer relative select-none ${
            isOwn ? "bg-white/20" : "bg-neutral-200 dark:bg-white/10"
          } ${!canSeek ? "opacity-60" : ""}`}
          onClick={seek}
          title={canSeek ? "Нажмите для перемотки" : "Загрузка..."}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label="Прогресс воспроизведения"
        >
          <div
            className={`h-full rounded-full transition-all duration-100 ${
              isOwn ? "bg-white/70" : "bg-violet-500 dark:bg-cyan-400"
            }`}
            style={{ width: `${progress * 100}%` }}
          />
          {/* FIX-SEEK: ручка перемотки (thumb) для наглядности */}
          {canSeek && progress > 0 && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow ${
                isOwn ? "bg-white" : "bg-violet-600 dark:bg-cyan-300"
              }`}
              style={{ left: `calc(${progress * 100}% - 6px)` }}
            />
          )}
        </div>
        <div className="flex justify-between mt-0.5">
          {/* FIX-SEEK: показываем текущую позицию всегда (и при паузе тоже) */}
          <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-neutral-400"}`}>
            {formatTime(currentTime)}
          </span>
          <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-neutral-400"}`}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={toggleMute}
          className={`p-1 rounded transition-colors ${isOwn ? "text-white/70 hover:text-white" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-gray-200"}`}
          title={muted ? "Включить звук" : "Без звука"}
          aria-label="Громкость"
        >
          <img
            src="/icons/loud.png"
            alt=""
            className="w-5 h-5 cn-icon"
            style={isOwn ? { filter: "brightness(0) invert(1)", opacity: muted ? 0.4 : 1 } : { opacity: muted ? 0.4 : 1 }}
          />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => changeVolume(parseFloat(e.target.value))}
          className="w-14 h-1 accent-violet-500 dark:accent-cyan-400 cursor-pointer"
          aria-label="Уровень громкости"
        />
      </div>
    </div>
  );
}
