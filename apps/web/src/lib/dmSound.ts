/**
 * DM notification sound via Web Audio API (no files needed).
 * Two-tone gentle ping — Discord-inspired but softer.
 *
 * Два выключателя, и оба обязаны работать:
 *   • «Звуковые уведомления» в настройках аккаунта — общий выключатель звука
 *     (см. lib/notifyPrefs). Раньше он не был подключён ни к чему: галочка
 *     сохранялась в базу, а звук всё равно играл;
 *   • «Звук сообщений» в TZ.Connect — выбор на этом устройстве. Он жил в
 *     обычной переменной модуля и пропадал при перезагрузке страницы: выключил
 *     звук, обновил вкладку — снова играет. Теперь хранится локально.
 */

import { notifySoundAllowed } from "@/lib/notifyPrefs";

const STORAGE_KEY = "tz-dm-sound";

let _ctx: AudioContext | null = null;
let _enabled: boolean | null = null;

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setDMSoundEnabled(v: boolean) {
  _enabled = v;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "on" : "off");
  } catch {
    /* приватный режим — выбор действует до перезагрузки */
  }
}

export function getDMSoundEnabled() {
  if (_enabled === null) _enabled = readEnabled();
  return _enabled;
}

function getCtx(): AudioContext | null {
  if (!getDMSoundEnabled()) return null;
  if (!notifySoundAllowed()) return null;
  if (typeof window === "undefined") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (!_ctx) {
    const w = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    _ctx = new (w.AudioContext || w.webkitAudioContext!)();
  }
  return _ctx;
}

export function playDMNotification() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    // First tone: E5
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.connect(g1); g1.connect(ctx.destination);
    o1.type = "sine"; o1.frequency.value = 659;
    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(0.12, now + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o1.start(now); o1.stop(now + 0.25);

    // Second tone: G5 (after 120ms)
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.type = "sine"; o2.frequency.value = 784;
    g2.gain.setValueAtTime(0, now + 0.12);
    g2.gain.linearRampToValueAtTime(0.09, now + 0.14);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o2.start(now + 0.12); o2.stop(now + 0.35);
  } catch { /* ignore */ }
}
