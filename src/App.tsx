import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from './components/Board';
import EvalBar from './components/EvalBar';
import EvalGraph from './components/EvalGraph';
import Importer, { type ImportedGame } from './components/Importer';
import { Engine, evaluatePosition } from './engine';
import { classifyMove, formatScore, gameAccuracy, parsePgn, sacrificeMap } from './analysis';
import { CLASS_INFO, CLASS_ORDER, ClassIcon, fmtLine, fmtSan, type Notation } from './classes';
import { SAMPLES } from './samples';
import type { Classification, Color, MoveAnalysis, ParsedGame, PositionEval } from './types';

type Tab = 'summary' | 'moves';
const GOOD: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced'];

export default function App() {
  const [pgn, setPgn] = useState('');
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>([]);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [depth, setDepth] = useState(14);
  const [notation, setNotation] = useState<Notation>('figurine');
  const [status, setStatus] = useState<'idle' | 'loading' | 'analyzing' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('moves');
  const [showInput, setShowInput] = useState(true);
  const [engineName, setEngineName] = useState('Stockfish');
  const engineRef = useRef<Engine | null>(null);
  const runRef = useRef(0);
  const startedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  const total = game?.moves.length ?? 0;
  const done = evals.filter(Boolean).length;

  const sacs = useMemo(() => (game ? sacrificeMap(game) : []), [game]);
  const cache = useRef(new Map<number, { b: PositionEval; a: PositionEval; r: MoveAnalysis }>());
  const analyses = useMemo<(MoveAnalysis | undefined)[]>(() => {
    if (!game) return [];
    return game.moves.map((m, i) => {
      const b = evals[i];
      const a = evals[i + 1];
      if (!b || !a) return undefined;
      const c = cache.current.get(i);
      if (c && c.b === b && c.a === a) return c.r;
      const r = classifyMove(m, game.moves[i - 1], b, a, sacs[i]);
      cache.current.set(i, { b, a, r });
      return r;
    });
  }, [game, evals, sacs]);

  const accuracy = useMemo(
    () => (game ? gameAccuracy(game.moves, analyses, evals) : { w: null, b: null }),
    [game, analyses, evals],
  );

  const start = useCallback(
    async (text: string, userColor?: Color) => {
      setError('');
      let g: ParsedGame;
      try {
        g = await parsePgn(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      const run = ++runRef.current;
      engineRef.current?.terminate();
      cache.current.clear();
      setGame(g);
      setEvals([]);
      setPly(0);
      setTab('moves');
      setShowInput(false);
      setOrientation(userColor === 'b' ? 'black' : 'white');
      setStatus('loading');
      startedAt.current = performance.now();
      let engine: Engine;
      try {
        engine = new Engine(2);
        engineRef.current = engine;
        await Promise.race([
          engine.ready,
          new Promise((_, rej) => setTimeout(() => rej(new Error('El motor tardó demasiado en cargar.')), 30000)),
        ]);
      } catch (e) {
        setStatus('error');
        setError('No se pudo iniciar Stockfish: ' + (e instanceof Error ? e.message : String(e)));
        return;
      }
      if (run !== runRef.current) return;
      setEngineName(engine.name);
      setStatus('analyzing');
      engine.newGame();
      const ucis = g.moves.map((m) => m.uci);
      const arr: (PositionEval | undefined)[] = new Array(g.moves.length + 1).fill(undefined);
      for (let i = 0; i <= g.moves.length; i++) {
        const fen = i === 0 ? g.startFen : g.moves[i - 1].fenAfter;
        const ev = await evaluatePosition(engine, g.startFen, ucis.slice(0, i), fen, depth, 4000);
        if (run !== runRef.current) return;
        arr[i] = ev;
        setEvals([...arr]);
        setElapsed(performance.now() - startedAt.current);
      }
      setStatus('done');
      setTab('summary');
    },
    [depth],
  );

  useEffect(() => () => engineRef.current?.terminate(), []);

  const go = useCallback((p: number) => setPly(Math.max(0, Math.min(total, p))), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!game) return;
      if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'ArrowRight') go(ply + 1);
      else if (e.key === 'ArrowUp' || e.key === 'Home') go(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') go(total);
      else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, ply, total, go]);

  const loadFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setPgn(String(r.result));
    r.readAsText(f);
  };

  const pickImported = (g: ImportedGame) => {
    setPgn(g.pgn);
    start(g.pgn, g.userColor);
  };

  /* ---- datos de la posición actual ---- */
  const move = game && ply > 0 ? game.moves[ply - 1] : undefined;
  const an = ply > 0 ? analyses[ply - 1] : undefined;
  const fen = game ? (move ? move.fenAfter : game.startFen) : new Chess().fen();
  const curEval = evals[ply];
  const arrows: { uci: string; brush: string }[] = [];
  if (an && move && !an.isBest && an.bestUci && an.classification !== 'book' && an.classification !== 'forced') {
    arrows.push({ uci: an.bestUci, brush: 'best' });
  }
  if (!move && curEval?.lines[0]) arrows.push({ uci: curEval.lines[0].pv[0], brush: 'best' });
  const inCheck = useMemo(() => new Chess(fen).inCheck(), [fen]);

  const h = game?.headers ?? {};
  const players = {
    w: { name: h.White || 'Blancas', elo: h.WhiteElo },
    b: { name: h.Black || 'Negras', elo: h.BlackElo },
  };
  const topColor: Color = orientation === 'white' ? 'b' : 'w';
  const botColor: Color = orientation === 'white' ? 'w' : 'b';

  const counts = useMemo(() => {
    const c: Record<Color, Record<string, number>> = { w: {}, b: {} };
    analyses.forEach((a, i) => {
      if (!a || !game) return;
      const col = game.moves[i].color;
      c[col][a.classification] = (c[col][a.classification] ?? 0) + 1;
    });
    return c;
  }, [analyses, game]);

  const sacrifices = useMemo(() => {
    const s: Record<Color, { ply: number; san: string; color: Color; amount: number; cls: Classification; ok: boolean }[]> = { w: [], b: [] };
    analyses.forEach((a, i) => {
      if (!a || !game || !a.sacrifice) return;
      const m = game.moves[i];
      s[m.color].push({ ply: i + 1, san: m.san, color: m.color, amount: a.sacrificeAmount, cls: a.classification, ok: GOOD.includes(a.classification) });
    });
    return s;
  }, [analyses, game]);

  const moveLabel = (p: number) => {
    const m = game!.moves[p - 1];
    const n = Math.ceil(p / 2);
    return `${n}${m.color === 'w' ? '.' : '...'} ${fmtSan(m.san, notation, m.color)}`;
  };

  const progressPct = total ? (done / (total + 1)) * 100 : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♞</span>
          <span>Analizador de Partidas</span>
        </div>
        <div className="top-controls">
          <label>
            Notación
            <select value={notation} onChange={(e) => setNotation(e.target.value as Notation)}>
              <option value="figurine">Figuras (♘f3)</option>
              <option value="es">Española (Cf3)</option>
              <option value="en">Inglesa (Nf3)</option>
            </select>
          </label>
          {game && (
            <button className="btn ghost" onClick={() => setShowInput((s) => !s)} data-testid="new-game">
              {showInput ? 'Volver a la revisión' : '＋ Nueva partida'}
            </button>
          )}
        </div>
        {(status === 'analyzing' || status === 'loading') && (
          <div className="top-progress" style={{ width: `${progressPct}%` }} />
        )}
      </header>

      <main className="layout">
        <section className="board-area">
          <PlayerBar name={players[topColor].name} elo={players[topColor].elo} color={topColor} acc={accuracy[topColor]} />
          <div className="board-row">
            <EvalBar score={curEval?.white} orientation={orientation} />
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={move ? [move.from, move.to] : undefined}
              arrows={arrows}
              badge={move && an ? { square: move.to, cls: an.classification } : undefined}
              check={inCheck}
            />
          </div>
          <PlayerBar name={players[botColor].name} elo={players[botColor].elo} color={botColor} acc={accuracy[botColor]} />
        </section>

        <aside className="panel">
          {(!game || showInput) && (
            <div className="input-panel">
              <h2>Revisión de partida</h2>
              <p className="muted">Pega una partida en formato PGN, sube un archivo .pgn o importa tus partidas recientes. Stockfish analizará cada jugada directamente en tu navegador.</p>
              <h3>Importar mis partidas</h3>
              <Importer onPick={pickImported} />
              <h3>O pega un PGN</h3>
              <textarea
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
                placeholder={'[Event "..."]\n1. e4 e5 2. Nf3 Nc6 ...'}
                spellCheck={false}
                data-testid="pgn-input"
              />
              <div className="row wrap">
                <label className="btn ghost file">
                  Subir .pgn
                  <input type="file" accept=".pgn,.txt,text/plain" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                </label>
                {SAMPLES.map((s, i) => (
                  <button key={s.id} className="btn ghost" title={s.name} onClick={() => setPgn(s.pgn)} data-testid={'sample-' + s.id}>
                    {i === 0 ? 'Ejemplo: Ópera de Morphy' : 'Ejemplo: Partida del siglo'}
                  </button>
                ))}
              </div>
              <div className="row">
                <label className="depth">
                  Profundidad
                  <select value={depth} onChange={(e) => setDepth(parseInt(e.target.value, 10))} data-testid="depth">
                    <option value={10}>10 (muy rápido)</option>
                    <option value={12}>12 (rápido)</option>
                    <option value={14}>14 (recomendado)</option>
                    <option value={16}>16 (preciso)</option>
                    <option value={18}>18 (lento)</option>
                  </select>
                </label>
                <button className="btn primary big" disabled={!pgn.trim()} onClick={() => start(pgn)} data-testid="analyze">
                  Analizar partida
                </button>
              </div>
              {error && <div className="error">{error}</div>}
            </div>
          )}

          {game && !showInput && (
            <>
              <div className="tabs">
                <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')} data-testid="tab-summary">
                  Resumen
                </button>
                <button className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')} data-testid="tab-moves">
                  Análisis
                </button>
              </div>

              {(status === 'analyzing' || status === 'loading') && (
                <div className="progress" data-testid="progress">
                  <div className="progress-text">
                    {status === 'loading' ? 'Cargando Stockfish…' : `Analizando… ${done}/${total + 1} posiciones · profundidad ${depth}`}
                  </div>
                  <div className="bar">
                    <div style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
              {error && <div className="error">{error}</div>}

              {tab === 'summary' && (
                <div className="summary" data-testid="summary">
                  <div className="game-title">
                    <strong>{players.w.name}</strong> vs <strong>{players.b.name}</strong>
                    <span className="muted"> · {h.Result ?? ''} {h.Date && h.Date !== '????.??.??' ? '· ' + h.Date.replace(/\./g, '/') : ''}</span>
                    {game.opening && <div className="opening">📖 {game.opening}</div>}
                  </div>
                  <EvalGraph evals={evals} analyses={analyses} total={total} ply={ply} onSelect={(p) => { go(p); }} height={80} />
                  <div className="acc-row">
                    {(['w', 'b'] as Color[]).map((c) => (
                      <div key={c} className={'acc-card ' + c} data-testid={'acc-' + c}>
                        <div className="acc-name">{players[c].name}</div>
                        <div className="acc-val">{accuracy[c] !== null ? accuracy[c]!.toFixed(1) : '—'}</div>
                        <div className="acc-lbl">Precisión</div>
                      </div>
                    ))}
                  </div>
                  <table className="counts">
                    <thead>
                      <tr>
                        <th />
                        <th>Blancas</th>
                        <th />
                        <th>Negras</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CLASS_ORDER.map((c) => (
                        <tr key={c}>
                          <td className="cl-name" style={{ color: CLASS_INFO[c].color }}>{CLASS_INFO[c].label}</td>
                          <td className="num">{counts.w[c] ?? 0}</td>
                          <td className="ic"><ClassIcon cls={c} size={20} /></td>
                          <td className="num">{counts.b[c] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="sacs" data-testid="sacrifices">
                    <h3>Sacrificios</h3>
                    <p className="muted small">Jugadas que entregan material (≥ 2 puntos) sin recuperación inmediata de igual valor.</p>
                    <div className="sac-cols">
                      {(['w', 'b'] as Color[]).map((c) => (
                        <div key={c} className="sac-col">
                          <div className="sac-head">{players[c].name}</div>
                          {sacrifices[c].length === 0 && <div className="muted small">Ninguno</div>}
                          {sacrifices[c].map((s) => (
                            <button key={s.ply} className={'sac ' + (s.ok ? 'ok' : 'bad')} onClick={() => { go(s.ply); setTab('moves'); }} data-testid="sac-item">
                              <ClassIcon cls={s.cls} size={16} />
                              <span className="sac-move">{moveLabel(s.ply)}</span>
                              <span className="sac-amt">−{s.amount}</span>
                              <span className="sac-verdict">{s.ok ? 'Correcto' : 'Incorrecto'} · {CLASS_INFO[s.cls].label}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  <button className="btn primary big full" onClick={() => { setTab('moves'); if (ply === 0) go(1); }}>
                    Revisar jugada por jugada
                  </button>
                  <div className="engine-note muted small">
                    Motor: {engineName} (WASM lite, 1 hilo) · profundidad {depth}
                    {status === 'done' && ` · ${(elapsed / 1000).toFixed(0)} s`}
                  </div>
                </div>
              )}

              {tab === 'moves' && (
                <div className="review">
                  <MoveCard
                    ply={ply}
                    game={game}
                    an={an}
                    ev={curEval}
                    notation={notation}
                  />
                  <EvalGraph evals={evals} analyses={analyses} total={total} ply={ply} onSelect={go} height={64} />
                  <MoveList game={game} analyses={analyses} ply={ply} onSelect={go} notation={notation} />
                </div>
              )}

              <div className="nav">
                <button onClick={() => go(0)} title="Inicio (↑ / Inicio)" data-testid="nav-first">⏮</button>
                <button onClick={() => go(ply - 1)} title="Anterior (←)" data-testid="nav-prev">◀</button>
                <button onClick={() => go(ply + 1)} title="Siguiente (→)" data-testid="nav-next">▶</button>
                <button onClick={() => go(total)} title="Final (↓ / Fin)" data-testid="nav-last">⏭</button>
                <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Girar tablero (F)" data-testid="flip">⟲</button>
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

function PlayerBar({ name, elo, color, acc }: { name: string; elo?: string; color: Color; acc: number | null }) {
  return (
    <div className="player-bar">
      <span className={'avatar ' + color}>{color === 'w' ? '♔' : '♚'}</span>
      <span className="pname">{name}</span>
      {elo && elo !== '?' && <span className="pelo">({elo})</span>}
      {acc !== null && <span className="pacc">{acc.toFixed(1)}%</span>}
    </div>
  );
}

function MoveCard({ ply, game, an, ev, notation }: { ply: number; game: ParsedGame; an?: MoveAnalysis; ev?: PositionEval; notation: Notation }) {
  const move = ply > 0 ? game.moves[ply - 1] : undefined;
  const evalChip = <span className={'eval-chip ' + (ev && (ev.white.kind === 'mate' ? ev.white.v > 0 || ev.white.mated === 'b' : ev.white.v >= 0) ? 'w' : 'b')} data-testid="move-eval">{ev ? formatScore(ev.white) : '…'}</span>;
  if (!move) {
    const best = ev?.lines[0];
    return (
      <div className="move-card" data-testid="move-card">
        <div className="mc-head">
          <span className="mc-title">Posición inicial</span>
          {evalChip}
        </div>
        {best && (
          <div className="mc-line">
            <span className="muted">Línea del motor:</span> {fmtLine(uciToSanSafe(game.startFen, best.pv), game.startFen, notation)}
          </div>
        )}
        <div className="muted small">Usa ← → para moverte por la partida.</div>
      </div>
    );
  }
  if (!an) {
    return (
      <div className="move-card" data-testid="move-card">
        <div className="mc-head">
          <span className="mc-title">{fmtSan(move.san, notation, move.color)}</span>
          {evalChip}
        </div>
        <div className="muted small">Analizando esta jugada…</div>
      </div>
    );
  }
  const info = CLASS_INFO[an.classification];
  const showBest = !an.isBest && an.bestSan && an.classification !== 'book' && an.classification !== 'forced';
  return (
    <div className="move-card" data-testid="move-card" style={{ borderColor: info.color }}>
      <div className="mc-head">
        <ClassIcon cls={an.classification} size={26} />
        <span className="mc-title" style={{ color: info.color }} data-testid="move-class">
          {fmtSan(move.san, notation, move.color)} {info.phrase}
        </span>
        {evalChip}
      </div>
      {an.classification === 'book' && move.opening && <div className="mc-line muted">{move.opening}</div>}
      {an.sacrifice && an.classification !== 'book' && (
        <div className="mc-line small">⚔️ Sacrificio de material (−{an.sacrificeAmount})</div>
      )}
      {showBest && (
        <div className="mc-best" data-testid="best-move">
          <ClassIcon cls="best" size={18} />
          <span>
            La mejor era <strong>{fmtSan(an.bestSan, notation, move.color)}</strong>
          </span>
          <span className="muted small"> (−{an.loss.toFixed(1)}% de prob. de ganar)</span>
        </div>
      )}
      {showBest && an.bestLineSan.length > 0 && (
        <div className="mc-line">
          <span className="muted">Mejor línea:</span> {fmtLine(an.bestLineSan, move.fenBefore, notation)}
        </div>
      )}
      {an.afterLineSan.length > 0 && (
        <div className="mc-line" data-testid="engine-line">
          <span className="muted">Línea del motor:</span> {fmtLine(an.afterLineSan, move.fenAfter, notation)}
        </div>
      )}
    </div>
  );
}

function uciToSanSafe(fen: string, pv: string[]) {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, 10)) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

function MoveList({ game, analyses, ply, onSelect, notation }: { game: ParsedGame; analyses: (MoveAnalysis | undefined)[]; ply: number; onSelect: (p: number) => void; notation: Notation }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.mv.active') as HTMLElement | null;
    if (el && ref.current) {
      const c = ref.current;
      const top = el.offsetTop - c.offsetTop;
      if (top < c.scrollTop || top > c.scrollTop + c.clientHeight - 40) c.scrollTop = top - c.clientHeight / 2;
    }
  }, [ply]);
  const rows: { n: number; w?: number; b?: number }[] = [];
  const firstBlack = game.moves[0]?.color === 'b';
  let num = parseInt(game.startFen.split(' ')[5] || '1', 10);
  let i = 0;
  if (firstBlack) {
    rows.push({ n: num++, b: 1 });
    i = 1;
  }
  for (; i < game.moves.length; i += 2) rows.push({ n: num++, w: i + 1, b: i + 2 <= game.moves.length ? i + 2 : undefined });
  const cell = (p?: number) => {
    if (!p) return <span className="mv empty" />;
    const m = game.moves[p - 1];
    const a = analyses[p - 1];
    return (
      <button className={'mv' + (p === ply ? ' active' : '')} onClick={() => onSelect(p)} data-testid="move" data-class={a?.classification ?? ''}>
        {a ? <ClassIcon cls={a.classification} size={16} /> : <span className="ic-ph" />}
        <span style={a && ['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'].includes(a.classification) ? { color: CLASS_INFO[a.classification].color } : undefined}>
          {fmtSan(m.san, notation, m.color)}
        </span>
      </button>
    );
  };
  return (
    <div className="move-list" ref={ref} data-testid="move-list">
      {rows.map((r) => (
        <div className="mrow" key={r.n}>
          <span className="mnum">{r.n}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
    </div>
  );
}
