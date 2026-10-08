import { useEffect, useState } from 'react';

/** useState persistido en localStorage */
export function usePersistent<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return { ...(initial as object), ...JSON.parse(raw) } as T;
    } catch {
      /* ignorar */
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignorar */
    }
  }, [key, v]);
  return [v, setV];
}

export interface EngineSettings {
  mode: 'depth' | 'time';
  depth: number;
  ms: number;
}
export const DEFAULT_ENGINE: EngineSettings = { mode: 'depth', depth: 14, ms: 1000 };

export interface SoundSettings {
  muted: boolean;
  volume: number;
}
export const DEFAULT_SOUND: SoundSettings = { muted: false, volume: 0.7 };

/** Tope de tiempo por posición en modo profundidad (evita bloqueos en posiciones complejas) */
export function depthCapMs(depth: number) {
  if (depth <= 14) return 4000;
  if (depth <= 16) return 8000;
  if (depth <= 18) return 15000;
  if (depth <= 20) return 30000;
  return 60000;
}

/** Estimación aproximada de segundos por posición (motor lite, 1 hilo) */
export function estimateSecondsPerPosition(s: EngineSettings) {
  if (s.mode === 'time') return s.ms / 1000;
  return Math.min(depthCapMs(s.depth) / 1000, 0.4 * Math.pow(1.8, (s.depth - 14) / 2));
}

export function fmtDuration(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
