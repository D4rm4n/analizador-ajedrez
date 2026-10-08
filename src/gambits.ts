import type { ImportedGame } from './components/Importer';

export interface GambitDef {
  key: string;
  name: string;
  /** bando que juega el gambito */
  side: 'w' | 'b';
  desc: string;
}

export const GAMBITS: GambitDef[] = [
  { key: 'kings', name: 'Gambito de Rey', side: 'w', desc: '1.e4 e5 2.f4' },
  { key: 'englund', name: 'Gambito Englund', side: 'b', desc: '1.d4 e5' },
  { key: 'smithmorra', name: 'Gambito Smith-Morra', side: 'w', desc: '1.e4 c5 2.d4 cxd4 3.c3' },
  { key: 'alien', name: 'Gambito Alien (Alapin)', side: 'w', desc: '1.e4 c5 2.c3 Nf6 3.e5 Nd5 … c4' },
  { key: 'evans', name: 'Gambito Evans', side: 'w', desc: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4' },
  { key: 'evansrev', name: 'Gambito Evans invertido', side: 'b', desc: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 … b5' },
  { key: 'other', name: 'Otros gambitos', side: 'w', desc: 'Aperturas cuyo nombre incluye «Gambit»' },
  { key: 'none', name: 'Otras aperturas', side: 'w', desc: 'Partidas sin gambito reconocido' },
];

/** Primeras jugadas SAN de un PGN (sin comentarios, variantes ni anotaciones) */
export function sanTokens(pgn: string, n = 20): string[] {
  const body = pgn
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ');
  return body
    .split(/\s+/)
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) => t.replace(/[+#!?]/g, ''))
    .slice(0, n);
}

const starts = (t: string[], seq: string[]) => seq.every((s, i) => t[i] === s);
const whiteMoves = (t: string[], upTo: number) => t.filter((_, i) => i % 2 === 0).slice(0, upTo);
const blackMoves = (t: string[], upTo: number) => t.filter((_, i) => i % 2 === 1).slice(0, upTo);

/** Detecta el gambito de una partida. Devuelve [clave, nombre de la variante] */
export function detectGambit(g: Pick<ImportedGame, 'pgn' | 'opening'>): [string, string | undefined] {
  const t = sanTokens(g.pgn);
  const name = g.opening ?? '';
  // 1) secuencias de jugadas (lo más fiable)
  if (starts(t, ['e4', 'e5', 'f4'])) return ['kings', name || undefined];
  if (starts(t, ['d4', 'e5'])) return ['englund', name || undefined];
  if (starts(t, ['e4', 'c5', 'd4', 'cxd4', 'c3'])) return ['smithmorra', name || undefined];
  if (starts(t, ['e4', 'c5', 'c3', 'Nf6', 'e5', 'Nd5']) && whiteMoves(t, 7).includes('c4')) return ['alien', name || undefined];
  if (starts(t, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'])) return ['evans', name || undefined];
  if (starts(t, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) && blackMoves(t, 7).includes('b5') && !whiteMoves(t, 4).includes('b4'))
    return ['evansrev', name || undefined];
  // 2) nombre de la apertura (ECO / Lichess)
  if (/King'?s Gambit/i.test(name)) return ['kings', name];
  if (/Englund/i.test(name)) return ['englund', name];
  if (/Smith[- ]?Morra/i.test(name)) return ['smithmorra', name];
  if (/Alien/i.test(name)) return ['alien', name];
  if (/Evans/i.test(name)) return ['evans', name];
  if (/gambit/i.test(name)) return ['other', name];
  return ['none', name || undefined];
}

/** Nombre corto de la variante: "Scandinavian Defense: Kloosterboer Gambit" → tal cual; slugs de chess.com recortados */
export function shortOpening(name?: string) {
  if (!name) return '';
  return name.replace(/\s+\d+\..*$/, '').slice(0, 60);
}

/* ---------- caché de partidas analizadas (localStorage) ---------- */

export interface AnalyzedInfo {
  /** número de jugada del primer Error / Error grave del usuario (null = ninguno) */
  firstError: number | null;
  userColor: 'w' | 'b';
  accuracy: number | null;
  at: number;
}
const KEY = 'aa.analyzed';

export function loadAnalyzed(): Record<string, AnalyzedInfo> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveAnalyzed(id: string, info: AnalyzedInfo) {
  try {
    const all = loadAnalyzed();
    all[id] = info;
    const keys = Object.keys(all);
    if (keys.length > 500) {
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 500).forEach((k) => delete all[k]);
    }
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignorar */
  }
}
