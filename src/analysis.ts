import { Chess, type Square } from 'chess.js';
import type { Classification, Color, EngineLine, MoveAnalysis, ParsedGame, PlyMove, PositionEval, Score } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ---------------- Probabilidad de ganar ---------------- */

/** Fórmula logística de Lichess: centipeones -> % de victoria (0..100) */
export function cpToWin(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** % de victoria para las blancas */
export function scoreToWhiteWin(s: Score): number {
  if (s.kind === 'cp') return cpToWin(s.v);
  if (s.v > 0) return 100;
  if (s.v < 0) return 0;
  return s.mated === 'b' ? 100 : 0;
}

export function winFor(s: Score, color: Color): number {
  const w = scoreToWhiteWin(s);
  return color === 'w' ? w : 100 - w;
}

export function lineWin(l: EngineLine): number {
  // desde el punto de vista del bando que mueve
  if (l.kind === 'cp') return cpToWin(l.v);
  return l.v > 0 ? 100 : 0;
}

export function lineToWhiteScore(l: EngineLine, stm: Color): Score {
  const sign = stm === 'w' ? 1 : -1;
  return { kind: l.kind, v: l.v * sign };
}

export function formatScore(s: Score | undefined): string {
  if (!s) return '0.0';
  if (s.kind === 'mate') {
    if (s.v === 0) return s.mated === 'b' ? '1-0' : '0-1';
    return (s.v > 0 ? '' : '-') + 'M' + Math.abs(s.v);
  }
  const p = s.v / 100;
  return (p > 0 ? '+' : '') + p.toFixed(Math.abs(p) >= 10 ? 0 : 1);
}

export function formatScoreShort(s: Score | undefined): string {
  if (!s) return '0.0';
  if (s.kind === 'mate') return s.v === 0 ? '#' : 'M' + Math.abs(s.v);
  const p = Math.abs(s.v / 100);
  return p >= 10 ? p.toFixed(0) : p.toFixed(1);
}

/* ---------------- Libro de aperturas ---------------- */

let bookPromise: Promise<Record<string, string | 0>> | null = null;
export function loadBook() {
  if (!bookPromise) {
    bookPromise = fetch(import.meta.env.BASE_URL + 'book.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return bookPromise;
}
const bookKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/* ---------------- PGN ---------------- */

function firstGame(pgn: string): string {
  const text = pgn.replace(/\r\n?/g, '\n').trim();
  // si hay varias partidas, quedarse con la primera
  const m = text.split(/\n\s*\n(?=\[Event )/);
  return m[0];
}

export async function parsePgn(pgn: string): Promise<ParsedGame> {
  const chess = new Chess();
  try {
    chess.loadPgn(firstGame(pgn), { strict: false });
  } catch (e) {
    throw new Error('No se pudo leer el PGN: ' + (e instanceof Error ? e.message : String(e)));
  }
  const headers = chess.getHeaders() as Record<string, string>;
  const history = chess.history({ verbose: true });
  if (history.length === 0) throw new Error('El PGN no contiene jugadas.');
  const startFen = history[0].before;
  const standardStart = bookKey(startFen) === bookKey(START_FEN);
  const book = standardStart ? await loadBook() : {};
  let inBook = standardStart;
  let opening: string | undefined;
  const moves: PlyMove[] = history.map((m, i) => {
    const before = new Chess(m.before);
    const legalCount = before.moves().length;
    let isBook = false;
    if (inBook) {
      const k = bookKey(m.after);
      if (k in book) {
        isBook = true;
        const nm = book[k];
        if (nm) opening = nm.replace('|', ' · ');
      } else inBook = false;
    }
    return {
      ply: i + 1,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      fenBefore: m.before,
      fenAfter: m.after,
      legalCount,
      isBook,
      opening: isBook ? opening : undefined,
    };
  });
  return { headers, startFen, moves, standardStart, opening: opening ?? headers['Opening'] };
}

/* ---------------- UCI -> SAN ---------------- */

export function uciLineToSan(fen: string, pv: string[], max = 12): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

/* ---------------- Detección de sacrificios ---------------- */

const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Máxima ganancia material inmediata del bando que mueve en `fen`:
 * para cada captura legal de una pieza (>= 3 puntos), ganancia = valor capturado
 * − (valor de la pieza capturadora si la casilla queda defendida).
 */
function maxCaptureGain(c: Chess, onlySquare?: string): number {
  const defender = c.turn() === 'w' ? 'b' : 'w';
  let maxGain = 0;
  for (const cap of c.moves({ verbose: true })) {
    if (!cap.captured) continue;
    if (onlySquare && cap.to !== onlySquare) continue;
    const target = VAL[cap.captured];
    if (target < 3) continue; // los peones no cuentan como sacrificio
    c.move(cap);
    const defended = c.isAttacked(cap.to as Square, defender);
    c.undo();
    if (defended && cap.piece === 'k') continue; // el rey no puede capturar algo defendido
    const gain = target - (defended ? VAL[cap.piece] : 0);
    if (gain > maxGain) maxGain = gain;
  }
  return maxGain;
}

/**
 * Material (en puntos) que la jugada entrega de más respecto a la alternativa que menos entrega.
 * Así no cuentan como sacrificio las jugadas forzadas que pierden material de todos modos
 * (p. ej. salir de un jaque con la dama ya colgada).
 */
export interface SacrificeInfo {
  amount: number;
  /** la pieza que acaba de mover queda capturable con ganancia */
  movedEnPrise: boolean;
}

export function detectSacrifice(move: PlyMove): SacrificeInfo {
  const none = { amount: 0, movedEnPrise: false };
  const after = new Chess(move.fenAfter);
  if (after.isCheckmate() || after.isStalemate()) return none;
  const capturedByMover = move.captured ? VAL[move.captured] : 0;
  const played = maxCaptureGain(after) - capturedByMover;
  if (played < 2) return none;
  const before = new Chess(move.fenBefore);
  let minAlt = Infinity;
  for (const alt of before.moves({ verbose: true })) {
    if (alt.from + alt.to + (alt.promotion ?? '') === move.uci) continue;
    before.move(alt);
    const g = before.isCheckmate() ? 0 : maxCaptureGain(before);
    before.undo();
    if (g < minAlt) minAlt = g;
    if (minAlt === 0) break;
  }
  if (minAlt === Infinity) return none;
  const movedEnPrise = maxCaptureGain(after, move.to) - capturedByMover >= 2;
  return { amount: Math.max(0, played - minAlt), movedEnPrise };
}

/** ¿La primera jugada de la línea del motor (rival) captura una pieza de >= 3 puntos? */
function pvTakesMaterial(fen: string, pv: string[] | undefined): boolean {
  if (!pv?.length) return false;
  const c = new Chess(fen);
  const target = c.get(pv[0].slice(2, 4) as Square);
  return !!target && VAL[target.type] >= 3;
}

/** Pre-calcula los sacrificios de toda la partida (no depende del motor) */
export function sacrificeMap(game: ParsedGame): SacrificeInfo[] {
  return game.moves.map((m) => (m.isBook ? { amount: 0, movedEnPrise: false } : detectSacrifice(m)));
}

/* ---------------- Clasificación ---------------- */

export function classifyMove(
  move: PlyMove,
  prev: PlyMove | undefined,
  before: PositionEval,
  after: PositionEval,
  sac: SacrificeInfo = { amount: 0, movedEnPrise: false },
): MoveAnalysis {
  const mover = move.color;
  const best = before.lines[0];
  const second = before.lines[1];
  const winBefore = winFor(before.white, mover);
  // un jaque mate siempre cuenta como mejor jugada (puede haber varios mates en 1)
  const isBest = (!!best && best.pv[0] === move.uci) || after.terminal === 'checkmate';

  let winAfter = winFor(after.white, mover);
  if (isBest) winAfter = Math.max(winAfter, winBefore);
  else if (second && second.pv[0] === move.uci) winAfter = lineWin(second);

  const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);
  // sacrificio real: entrega >= 2 puntos y, o bien la pieza movida queda colgada,
  // o bien el motor espera que el rival capture material de inmediato
  const sacrifice = sac.amount >= 2 && (sac.movedEnPrise || pvTakesMaterial(move.fenAfter, after.lines[0]?.pv));
  const sacrificeAmount = sacrifice ? sac.amount : 0;

  let cls: Classification;
  if (move.legalCount === 1) cls = 'forced';
  else if (move.isBook) cls = 'book';
  else {
    const nearBest = isBest || loss < 2;
    const bestWin = best ? lineWin(best) : winBefore;
    const secondWin = second ? lineWin(second) : null;
    const isRecapture = !!(prev && prev.captured && move.captured && prev.to === move.to);
    if (nearBest && sacrifice && winBefore < 90 && winAfter >= 50) cls = 'brilliant';
    else if (
      isBest &&
      secondWin !== null &&
      bestWin - secondWin >= 15 &&
      secondWin < 80 &&
      winBefore < 95 &&
      !isRecapture
    )
      cls = 'great';
    else if (isBest) cls = 'best';
    else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';
  }

  const accuracy =
    cls === 'book' || cls === 'forced'
      ? 100
      : Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * loss) - 3.166924740191411));

  return {
    classification: cls,
    winBefore,
    winAfter,
    loss,
    accuracy,
    bestUci: best?.pv[0],
    bestSan: best ? uciLineToSan(move.fenBefore, best.pv, 1)[0] : undefined,
    bestLineSan: best ? uciLineToSan(move.fenBefore, best.pv, 10) : [],
    afterLineSan: after.lines[0] ? uciLineToSan(move.fenAfter, after.lines[0].pv, 10) : [],
    isBest,
    sacrifice,
    sacrificeAmount,
  };
}

/* ---------------- Precisión (estilo Lichess / chess.com) ---------------- */

function stdev(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export function gameAccuracy(moves: PlyMove[], analyses: (MoveAnalysis | undefined)[], evals: (PositionEval | undefined)[]) {
  const wins = evals.map((e) => (e ? scoreToWhiteWin(e.white) : 50));
  const ws = Math.max(2, Math.min(8, Math.floor(moves.length / 10)));
  const res: Record<Color, number | null> = { w: null, b: null };
  for (const color of ['w', 'b'] as Color[]) {
    let wsum = 0, wtot = 0, hsum = 0, n = 0;
    moves.forEach((m, i) => {
      const a = analyses[i];
      if (!a || m.color !== color) return;
      const start = Math.max(0, i + 1 - ws);
      const win = wins.slice(start, i + 2);
      const weight = Math.max(0.5, Math.min(12, stdev(win)));
      wsum += a.accuracy * weight;
      wtot += weight;
      hsum += 1 / Math.max(1, a.accuracy);
      n++;
    });
    if (n > 0) res[color] = (wsum / wtot + n / hsum) / 2;
  }
  return res;
}
