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

  async analyse(startFen: string, moves: string[], depth: number | null, maxMs: number): Promise<EngineLine[]> {
    await this.ready;
    return new Promise((resolve) => {
      this.job = { resolve, lines: [] };
      const pos = moves.length ? `position fen ${startFen} moves ${moves.join(' ')}` : `position fen ${startFen}`;
      this.send(pos);
      this.send(depth ? `go depth ${depth} movetime ${maxMs}` : `go movetime ${maxMs}`);
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
  depth: number | null,
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

/* ------------------------------------------------------------------ */

export interface LiveUpdate {
  fen: string;
  lines: EngineLine[];
  depth: number;
  done: boolean;
}

/** Motor para el análisis libre: análisis continuo (infinito o hasta una profundidad) con MultiPV */
export class LiveEngine {
  private worker: Worker;
  private ready: Promise<void>;
  private searching = false;
  private waiters: { token: string; resolve: () => void }[] = [];
  private gen = 0;
  private fen = '';
  private lines: EngineLine[] = [];
  private lastEmit = 0;
  private timer: number | null = null;
  onUpdate: (u: LiveUpdate) => void = () => {};

  constructor(multiPv = 3) {
    const w = new Worker(import.meta.env.BASE_URL + ENGINE_FILE);
    this.worker = w;
    w.onmessage = (e) => this.onLine(String(e.data));
    this.ready = (async () => {
      w.postMessage('uci');
      await this.waitFor('uciok');
      w.postMessage('setoption name Hash value 64');
      w.postMessage(`setoption name MultiPV value ${multiPv}`);
      w.postMessage('isready');
      await this.waitFor('readyok');
    })();
  }

  private waitFor(token: string) {
    return new Promise<void>((resolve) => this.waiters.push({ token, resolve }));
  }

  private emit(done = false) {
    const lines = this.lines.filter(Boolean);
    this.onUpdate({ fen: this.fen, lines: [...lines], depth: lines[0]?.depth ?? 0, done });
    this.lastEmit = performance.now();
  }

  private onLine(line: string) {
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      if (this.fen) this.emit(true);
    }
    for (const w of [...this.waiters]) {
      if (line.startsWith(w.token)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve();
      }
    }
    if (!this.searching || !line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return;
    if (line.includes('lowerbound') || line.includes('upperbound')) return;
    const t = line.split(' ');
    const get = (k: string) => t[t.indexOf(k) + 1];
    const depth = parseInt(get('depth'), 10);
    const mpv = t.includes('multipv') ? parseInt(get('multipv'), 10) : 1;
    const si = t.indexOf('score');
    const kind = t[si + 1] === 'mate' ? 'mate' : 'cp';
    const v = parseInt(t[si + 2], 10);
    const pv = t.slice(t.indexOf('pv') + 1);
    // al empezar una nueva profundidad, las líneas secundarias antiguas se mantienen hasta ser reemplazadas
    this.lines[mpv - 1] = { depth, kind, v, pv };
    const now = performance.now();
    if (now - this.lastEmit > 200) this.emit();
    else if (!this.timer) this.timer = window.setTimeout(() => { this.timer = null; this.emit(); }, 200);
  }

  /** Analiza `fen` (detiene el análisis anterior). depth = null → infinito */
  async analyse(fen: string, depth: number | null) {
    const g = ++this.gen;
    await this.ready;
    if (this.searching) {
      this.worker.postMessage('stop');
      await this.waitFor('bestmove');
    }
    if (g !== this.gen) return;
    this.fen = fen;
    this.lines = [];
    this.searching = true;
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(depth ? `go depth ${depth}` : 'go infinite');
  }

  async stop() {
    ++this.gen;
    this.fen = '';
    if (this.searching) {
      this.worker.postMessage('stop');
      await this.waitFor('bestmove');
    }
  }

  terminate() {
    this.worker.terminate();
  }
}
