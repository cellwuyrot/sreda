"use client";

import { useRef, useState, useCallback } from "react";

interface VideoPlayerProps {
  url: string;
  isOwn?: boolean;
}

/**
 * Native <video> player with a custom volume slider (loud.png icon).
 * The browser's default controls handle play/pause/seek/fullscreen; the volume
 * control lives in a bar UNDER the video, inside the message itself — not in a
 * hover popup — so it never overlaps the message hover toolbar or the native
 * video controls.
 */
export default function VideoPlayer({ url, isOwn }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    const video = videoRef.current;
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
    setMuted(v === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (muted || volume === 0) {
      const restore = volume === 0 ? 1 : volume;
      video.muted = false;
      video.volume = restore;
      setVolume(restore);
      setMuted(false);
    } else {
      video.muted = true;
      setMuted(true);
    }
  }, [muted, volume]);

  return (
    <div className="mt-1 rounded-lg overflow-hidden max-w-[280px]">
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        className="w-full max-h-[240px] bg-black"
      />
      {/* Громкость — встроенная панель под видео, прямо в сообщении. */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 ${
          isOwn ? "bg-white/10" : "bg-neutral-100 dark:bg-white/5"
        }`}
      >
        <button
          onClick={toggleMute}
          className={`p-0.5 rounded transition-colors flex-shrink-0 ${isOwn ? "text-white/80 hover:text-white" : "text-neutral-500 hover:text-neutral-700 dark:text-gray-300 dark:hover:text-white"}`}
          title={muted ? "Включить звук" : "Без звука"}
          aria-label="Громкость видео"
        >
          <img
            src="/icons/loud.png"
            alt=""
            className="w-4 h-4 cn-icon"
            style={isOwn ? { filter: "brightness(0) invert(1)", opacity: muted ? 0.5 : 1 } : { opacity: muted ? 0.5 : 1 }}
          />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => changeVolume(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-violet-500 dark:accent-cyan-400 cursor-pointer"
          aria-label="Уровень громкости видео"
        />
      </div>
    </div>
  );
}
