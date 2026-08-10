/**
 * FIX-SFX: локальные звуки действий интерфейса через Web Audio API (без файлов),
 * в одном звуковом языке с dmSound.ts / msgSound.ts — короткие мягкие
 * синусоидальные блипы.
 *
 * ВАЖНО: эти звуки играют ТОЛЬКО у пользователя, который нажал кнопку
 * (вызываются напрямую из обработчиков локальных действий и никогда — из
 * socket-событий о действиях других участников).
 *
 * Набор:
 *   micOn / micOff         — включение/выключение микрофона
 *   deafenOn / deafenOff   — выключение/включение звука (наушники)
 *   screenShareStop        — остановка демонстрации экрана
 *   taskCreate             — задача успешно создана
 * (Звук СТАРТА демонстрации остаётся существующим /sounds/screenshare.mp3 —
 *  он уже играет локально в startScreenShare.)
 */

export type UiSoundName =
  | "micOn"
  | "micOff"
  | "deafenOn"
  | "deafenOff"
  | "screenShareStop"
  | "taskCreate";

let _ctx: AudioContext | null = null;
let _enabled = true;
let _sinkId: string | null = null;

export function setUiSoundsEnabled(v: boolean) { _enabled = v; }
export function getUiSoundsEnabled() { return _enabled; }

/** Направить звуки интерфейса на выбранное устройство вывода (Chromium 110+). */
export function setUiSoundsSink(deviceId: string | null) {
  _sinkId = deviceId;
  applySink(_ctx);
}

type SinkTarget = { setSinkId?: (id: string) => Promise<void> };

function applySink(ctx: AudioContext | null) {
  if (!ctx) return;
  const c = ctx as AudioContext & SinkTarget;
  if (typeof c.setSinkId !== "function") return;
  c.setSinkId(_sinkId ?? "").catch(() => { /* устройство могло исчезнуть */ });
}

function getCtx(): AudioContext | null {
  if (!_enabled) return null;
  if (typeof window === "undefined") return null;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  if (!_ctx) {
    try {
      const w = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      _ctx = new (w.AudioContext || w.webkitAudioContext!)();
      applySink(_ctx);
    } catch {
      return null;
    }
  }
  if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
  return _ctx;
}

interface Tone {
  /** Частота, Гц. */
  f: number;
  /** Смещение старта от начала звука, сек. */
  at: number;
  /** Длительность, сек. */
  dur: number;
  /** Пиковая громкость (0..1). */
  gain: number;
  type?: OscillatorType;
}

function play(tones: Tone[]) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = t.type ?? "sine";
      osc.frequency.value = t.f;
      g.gain.setValueAtTime(0.0001, now + t.at);
      g.gain.linearRampToValueAtTime(t.gain, now + t.at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t.at + t.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + t.at);
      osc.stop(now + t.at + t.dur + 0.02);
    }
  } catch { /* звук — некритично */ }
}

/* Дизайн: пары «вкл/выкл» — зеркальные (вверх = включилось, вниз = выключилось),
 * микрофон — светлее и выше, наушники — ниже и мягче, чтобы на слух отличались. */
const SOUNDS: Record<UiSoundName, Tone[]> = {
  micOn: [
    { f: 659, at: 0, dur: 0.11, gain: 0.11 },
    { f: 880, at: 0.07, dur: 0.16, gain: 0.12 },
  ],
  micOff: [
    { f: 880, at: 0, dur: 0.11, gain: 0.1 },
    { f: 659, at: 0.07, dur: 0.16, gain: 0.09 },
  ],
  deafenOn: [
    { f: 392, at: 0, dur: 0.12, gain: 0.11 },
    { f: 294, at: 0.08, dur: 0.2, gain: 0.1 },
  ],
  deafenOff: [
    { f: 294, at: 0, dur: 0.12, gain: 0.1 },
    { f: 392, at: 0.08, dur: 0.2, gain: 0.11 },
  ],
  // Нисходящее трезвучие — «зеркало» звука старта демонстрации.
  screenShareStop: [
    { f: 784, at: 0, dur: 0.12, gain: 0.1 },
    { f: 659, at: 0.09, dur: 0.12, gain: 0.09 },
    { f: 523, at: 0.18, dur: 0.22, gain: 0.09 },
  ],
  // Мягкое подтверждение «задача создана»: короткий поп + звонкий хвост.
  taskCreate: [
    { f: 587, at: 0, dur: 0.09, gain: 0.09 },
    { f: 880, at: 0.06, dur: 0.14, gain: 0.11 },
    { f: 1175, at: 0.13, dur: 0.22, gain: 0.08 },
  ],
};

/** Проиграть локальный звук интерфейса (только для нажавшего пользователя). */
export function playUiSound(name: UiSoundName) {
  play(SOUNDS[name]);
}
