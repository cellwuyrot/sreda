"use client";

import { memo, useState, useRef, useEffect, useCallback } from "react";

interface VoicePlayerProps {
  url: string;
  duration?: number;
  isOwn?: boolean;
  e2eeIv?: string;
  e2eeDecrypt?: (encrypted: ArrayBuffer, iv: string) => Promise<ArrayBuffer>;
}

/**
 * Голосовое сообщение.
 *
 * ВАЖНО: Audio больше не создаётся при монтировании компонента. В длинной
 * ленте сообщения виртуализируются, поэтому при прокрутке десятки VoicePlayer
 * могут быстро монтироваться/размонтироваться. Раньше каждый из них сразу
 * создавал HTMLAudioElement с preload=metadata, что запускало загрузку медиа
 * даже без нажатия Play и создавало лишнюю нагрузку на сеть/декодер/GC.
 * Теперь загрузка и расшифровка начинаются только по явному Play.
 */
function VoicePlayer({ url, duration: initialDuration, isOwn, e2eeIv, e2eeDecrypt }: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [error, setError] = useState(false);
  const [decrypting, setDecrypting] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const disposeAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;

    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return disposeAudio;
  }, [url, e2eeIv, initialDuration, disposeAudio]);

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
    if (!audio) {
      setMuted((prev) => !prev);
      return;
    }
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

  const setupAudio = useCallback(
    (audio: HTMLAudioElement) => {
      audio.preload = "metadata";
      audio.volume = volume;
      audio.muted = muted;
      audioRef.current = audio;

      audio.onloadedmetadata = () => {
        if (audio.duration && isFinite(audio.duration)) {
          setDuration(Math.round(audio.duration));
        }
      };

      audio.ontimeupdate = () => {
        if (audio.duration && isFinite(audio.duration)) {
          setProgress(audio.currentTime / audio.duration);
          setCurrentTime(audio.currentTime);
        }
      };

      audio.onended = () => {
        setPlaying(false);
        setProgress(0);
        setCurrentTime(0);
      };

      audio.onerror = () => {
        setError(true);
        setPlaying(false);
      };
    },
    [muted, volume],
  );

  const ensureAudio = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;

    setError(false);

    if (e2eeIv && e2eeDecrypt) {
      setDecrypting(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Voice download failed: ${response.status}`);
        const encrypted = await response.arrayBuffer();
        const decrypted = await e2eeDecrypt(encrypted, e2eeIv);
        if (controller.signal.aborted) return null;

        const blob = new Blob([decrypted], { type: "audio/webm" });
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        setupAudio(audio);
        setDecrypting(false);
        abortRef.current = null;
        return audio;
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
          setDecrypting(false);
        }
        return null;
      }
    }

    const audio = new Audio(url);
    setupAudio(audio);
    return audio;
  }, [url, e2eeIv, e2eeDecrypt, setupAudio]);

  const toggle = useCallback(async () => {
    if (decrypting) return;

    const existing = audioRef.current;
    if (existing && !existing.paused) {
      existing.pause();
      setPlaying(false);
      return;
    }

    const audio = await ensureAudio();
    if (!audio) return;

    try {
      setError(false);
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError(true);
    }
  }, [decrypting, ensureAudio]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !isFinite(audio.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
    setCurrentTime(audio.currentTime);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s) % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
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
              ? "bg-red-100 dark:bg-red-900/30 text-red-500"
              : isOwn
                ? "bg-white/20 hover:bg-white/30 text-white"
                : "bg-violet-100 dark:bg-cyan-400/20 hover:bg-violet-200 dark:hover:bg-cyan-400/30 text-accent"
        }`}
      >
        {decrypting ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
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
        <div
          className={`h-1.5 rounded-full cursor-pointer ${
            isOwn ? "bg-white/20" : "bg-neutral-200 dark:bg-white/10"
          }`}
          onClick={seek}
        >
          <div
            className={`h-full rounded-full transition-all duration-100 ${
              isOwn ? "bg-white/70" : "bg-violet-500 dark:bg-cyan-400"
            }`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-neutral-400"}`}>
            {playing ? formatTime(currentTime) : formatTime(0)}
          </span>
          <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-neutral-400"}`}>
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Громкость — встроена прямо в сообщение (без всплывающего окна),
          поэтому она не может перекрываться hover-тулбаром сообщения. */}
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

export default memo(VoicePlayer);
