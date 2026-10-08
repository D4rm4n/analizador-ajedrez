/**
 * Sonidos de piezas de madera sintetizados con la Web Audio API.
 * No se usan archivos de audio externos (sin problemas de licencia).
 */
export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'end' | 'illegal';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let volume = 0.7;
let muted = false;

declare global {
  interface Window {
    __soundLog?: { kind: SoundKind; muted: boolean; t: number }[];
  }
}

function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = volume;
}
export function setMuted(m: boolean) {
  muted = m;
}

/** Un "clac" de madera: ráfaga de ruido filtrada + resonancia grave corta */
function clack(t: number, o: { freq?: number; q?: number; decay?: number; gain?: number; body?: number; bodyGain?: number } = {}) {
  const c = ctx!;
  const { freq = 1700, q = 1.4, decay = 0.045, gain = 0.9, body = 190, bodyGain = 0.55 } = o;
  // ataque (ruido filtrado)
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(bp).connect(g).connect(master!);
  src.start(t);
  src.stop(t + decay + 0.02);
  // cuerpo de la madera
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(body * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(body, t + 0.03);
  const og = c.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(bodyGain, t + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 1.8);
  osc.connect(og).connect(master!);
  osc.start(t);
  osc.stop(t + decay * 2 + 0.02);
}

function tone(t: number, f: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const c = ctx!;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.value = f;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master!);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export function play(kind: SoundKind) {
  (window.__soundLog ??= []).push({ kind, muted, t: Date.now() });
  if (muted || volume <= 0) return;
  const c = ensure();
  if (!c || !master || !noiseBuf) return;
  const t = c.currentTime + 0.005;
  switch (kind) {
    case 'move':
      clack(t);
      break;
    case 'capture':
      clack(t, { freq: 2300, gain: 1, decay: 0.05, body: 230, bodyGain: 0.7 });
      clack(t + 0.04, { freq: 1300, gain: 0.55, decay: 0.04, body: 170, bodyGain: 0.35 });
      break;
    case 'castle':
      clack(t, { freq: 1600 });
      clack(t + 0.11, { freq: 1900, gain: 0.8 });
      break;
    case 'check':
      clack(t, { freq: 2000, gain: 1 });
      tone(t + 0.02, 1046, 0.18, 0.12, 'triangle');
      break;
    case 'end':
      clack(t);
      tone(t + 0.08, 523.25, 0.5, 0.18, 'triangle');
      tone(t + 0.2, 659.25, 0.5, 0.15, 'triangle');
      tone(t + 0.32, 783.99, 0.7, 0.15, 'triangle');
      break;
    case 'illegal':
      clack(t, { freq: 420, q: 0.8, gain: 0.7, decay: 0.07, body: 110, bodyGain: 0.6 });
      break;
  }
}

/** Sonido adecuado para una jugada en SAN */
export function soundForSan(san: string, isLast = false): SoundKind {
  if (san.includes('#')) return 'end';
  if (san.includes('+')) return 'check';
  if (isLast) return 'end';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  return 'move';
}
