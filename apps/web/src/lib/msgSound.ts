/**
 * Notification sound for incoming channel messages.
 * Synthesised via Web Audio API — zero files needed.
 * Two flavours:
 *   playMsgNotification() — soft ping for channel messages
 *   playMentionNotification() — two-tone for @mentions
 *
 * Общий выключатель — «Звуковые уведомления» в настройках аккаунта
 * (см. lib/notifyPrefs). Раньше он не был подключён ни к чему, и звук сообщений
 * канала играл всегда: выключить его было нечем вообще — сеттеры ниже никто не
 * вызывал.
 */

import { notifySoundAllowed } from "@/lib/notifyPrefs";

let _ctx: AudioContext | null = null;
let _msgEnabled    = true;
let _mentionEnabled = true;

export function setMsgSoundEnabled(v: boolean)     { _msgEnabled = v; }
export function setMentionSoundEnabled(v: boolean) { _mentionEnabled = v; }
export function getMsgSoundEnabled()     { return _msgEnabled; }
export function getMentionSoundEnabled() { return _mentionEnabled; }

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (!_ctx) {
    const w = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    _ctx = new (w.AudioContext || w.webkitAudioContext!)();
  }
  return _ctx;
}

function tone(freq: number, vol: number, start: number, duration: number, type: OscillatorType = "sine") {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.connect(g); g.connect(c.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = c.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.start(t);
  osc.stop(t + duration);
}

/** Soft single-tone ping — channel message */
export function playMsgNotification() {
  if (!_msgEnabled || !notifySoundAllowed()) return;
  tone(880, 0.08, 0, 0.18);
}

/** Two-tone — @mention */
export function playMentionNotification() {
  if (!_mentionEnabled || !notifySoundAllowed()) return;
  tone(880, 0.1, 0,    0.14);
  tone(1108, 0.08, 0.12, 0.18);
}
