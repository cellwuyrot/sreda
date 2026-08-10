"use client";

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function noise(ctx: AudioContext, duration: number): AudioBufferSourceNode {
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** Sword clash / metal impact */
export function playSwordClash() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // High metallic ping
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

  // Metal ring
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(3000, t);
  osc2.frequency.exponentialRampToValueAtTime(800, t + 0.3);

  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.15, t);
  gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

  osc.connect(gain).connect(ctx.destination);
  osc2.connect(gain2).connect(ctx.destination);

  osc.start(t);
  osc.stop(t + 0.2);
  osc2.start(t);
  osc2.stop(t + 0.3);
}

/** Combat start — war horn */
export function playWarHorn() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.linearRampToValueAtTime(180, t + 0.3);
  osc.frequency.linearRampToValueAtTime(160, t + 0.8);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.2, t + 0.1);
  gain.gain.setValueAtTime(0.2, t + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 1.0);

  // Low-pass filter for horn-like timbre
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(600, t);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 1.0);
}

/** Dice roll */
export function playDiceRoll() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Short rattling clicks
  for (let i = 0; i < 6; i++) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    const freq = 800 + Math.random() * 400;
    const offset = i * 0.06 + Math.random() * 0.02;
    osc.frequency.setValueAtTime(freq, t + offset);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.04);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.04);
  }

  // Final thud
  const thud = ctx.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(200, t + 0.4);
  thud.frequency.exponentialRampToValueAtTime(80, t + 0.55);

  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.2, t + 0.4);
  thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

  thud.connect(thudGain).connect(ctx.destination);
  thud.start(t + 0.4);
  thud.stop(t + 0.55);
}

/** God summon — mystical chime */
export function playGodSummon() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t + i * 0.12);
    gain.gain.linearRampToValueAtTime(0.12, t + i * 0.12 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.8);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t + i * 0.12);
    osc.stop(t + i * 0.12 + 0.8);
  });
}

/** Victory fanfare */
export function playVictory() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const melody = [
    { freq: 392, dur: 0.15 }, // G4
    { freq: 523, dur: 0.15 }, // C5
    { freq: 659, dur: 0.15 }, // E5
    { freq: 784, dur: 0.4 },  // G5
    { freq: 659, dur: 0.1 },  // E5
    { freq: 784, dur: 0.6 },  // G5
  ];

  let offset = 0;
  for (const note of melody) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(note.freq, t + offset);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, t + offset + note.dur);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + note.dur);
    offset += note.dur;
  }
}

/** Unit placement — light stamp */
export function playPlace() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

/** Unit move — footsteps */
export function playMove() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  for (let i = 0; i < 2; i++) {
    const n = noise(ctx, 0.06);
    const gain = ctx.createGain();
    const off = i * 0.1;
    gain.gain.setValueAtTime(0.08, t + off);
    gain.gain.exponentialRampToValueAtTime(0.001, t + off + 0.06);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(400, t + off);

    n.connect(filter).connect(gain).connect(ctx.destination);
    n.start(t + off);
    n.stop(t + off + 0.06);
  }
}

/** Card played */
export function playCardFlip() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const n = noise(ctx, 0.05);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(2000, t);

  n.connect(filter).connect(gain).connect(ctx.destination);
  n.start(t);
  n.stop(t + 0.05);
}

/** Defeat / unit destroyed */
export function playDefeat() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(800, t);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

/** Turn change — gentle bell */
export function playTurnChange() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.4);
}

/** Teleport / smuggler — whoosh */
export function playTeleport() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const n = noise(ctx, 0.4);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(500, t);
  filter.frequency.exponentialRampToValueAtTime(3000, t + 0.3);
  filter.Q.setValueAtTime(2, t);

  n.connect(filter).connect(gain).connect(ctx.destination);
  n.start(t);
  n.stop(t + 0.4);
}

/** City captured */
export function playCityCapture() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  // Short triumphant chord
  [262, 330, 392].forEach((freq) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

/** Error / denied action */
export function playError() {
  const ctx = getCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.setValueAtTime(150, t + 0.1);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}
