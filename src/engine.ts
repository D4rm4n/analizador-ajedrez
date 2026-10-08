import { Chess } from 'chess.js';
import type { Color, EngineLine, PositionEval } from './types';
import { lineToWhiteScore } from './analysis';

export const ENGINE_FILE = 'engine/stockfish-19-lite-single.js';

interface Job {
  resolve: (lines: EngineLine[]) => void;
  lines: EngineLine[];
}

/** Envoltorio mínimo de Stockfish (WASM, un hilo) en un Web Worker */
export class Engine {
  private worker: Worker;
  private job: Job | null = null;
  private waiters: { token: string; resolve: () => void }[] = [];
  ready: Promise<void>;
  name = 'Stockfish';

  constructor(multiPv = 2) {
    this.worker = new Worker(import.meta.env.BASE_URL + ENGINE_FILE);
    this.worker.onmessage = (e) => this.onLine(String(e.data));
    this.ready = (async () => {
      this.send('uci');
      await this.waitFor('uciok');
      this.send('setoption name Hash value 32');
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.send('isready');
      await this.waitFor('readyok');
    })();
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(token: string) {
    return new Promise<void>((resolve) => this.waiters.push({ token, resolve }));
  }

  private onLine(line: string) {
    if (line.startsWith('id name ')) this.name = line.slice(8);
    for (const w of [...this.waiters]) {
      if (line.startsWith(w.token)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve();
      }
    }
    if (!this.job) return;
    if (line.startsWith('info ') && line.includes(' pv ') && line.includes(' score ')) {
      if (line.includes('lowerbound') || line.includes('upperbound')) return;
      const t = line.split(' ');
      const get = (k: string) => t[t.indexOf(k) + 1];
      const depth = parseInt(get('depth'), 10);
      const mpv = t.includes('multipv') ? parseInt(get('multipv'), 10) : 1;
      const si = t.indexOf('score');
      const kind = t[si + 1] === 'mate' ? 'mate' : 'cp';
      const v = parseInt(t[si + 2], 10);
      const pv = t.slice(t.indexOf('pv') + 1);
      this.job.lines[mpv - 1] = { depth, kind, v, pv };
    } else if (line.startsWith('bestmove')) {
      const j = this.job;
      this.job = null;
      const best = line.split(' ')[1];
      if (j.lines.length === 0 && best && best !== '(none)') j.lines[0] = { depth: 0, kind: 'cp', v: 0, pv: [best] };
      j.resolve(j.lines.filter(Boolean));
    }
  }

  async analyse(startFen: string, moves: string[], depth: number, maxMs: number): Promise<EngineLine[]> {
    await this.ready;
    return new Promise((resolve) => {
      this.job = { resolve, lines: [] };
      const pos = moves.length ? `position fen ${startFen} moves ${moves.join(' ')}` : `position fen ${startFen}`;
      this.send(pos);
      this.send(`go depth ${depth} movetime ${maxMs}`);
    });
  }

  newGame() {
    this.send('ucinewgame');
  }

  terminate() {
    this.worker.terminate();
  }
}

/** Evalúa la posición tras `moves` jugadas (desde startFen) */
export async function evaluatePosition(
  engine: Engine,
  startFen: string,
  moves: string[],
  fen: string,
  depth: number,
  maxMs: number,
): Promise<PositionEval> {
  const c = new Chess(fen);
  const stm = c.turn() as Color;
  if (c.isCheckmate()) {
    return { fen, white: { kind: 'mate', v: 0, mated: stm }, lines: [], terminal: 'checkmate', depth: 0 };
  }
  if (c.isStalemate() || c.isInsufficientMaterial()) {
    return { fen, white: { kind: 'cp', v: 0 }, lines: [], terminal: 'draw', depth: 0 };
  }
  const lines = await engine.analyse(startFen, moves, depth, maxMs);
  const white = lines[0] ? lineToWhiteScore(lines[0], stm) : { kind: 'cp' as const, v: 0 };
  return { fen, white, lines, depth: lines[0]?.depth ?? 0 };
}
