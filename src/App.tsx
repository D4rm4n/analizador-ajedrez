import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from './components/Board';
import EvalBar from './components/EvalBar';
import EvalGraph from './components/EvalGraph';
import Importer, { type ImportedGame } from './components/Importer';
import FreePanel, { isTerminal, type WhyInfo } from './components/FreePanel';
import { EngineControls, SoundControls } from './components/Controls';
import { MoveCard, MoveList, PlayerBar } from './components/ReviewParts';
import { Engine, LiveEngine, evaluatePosition, type LiveUpdate } from './engine';
import { START_FEN, classifyMove, gameAccuracy, lineToWhiteScore, materialBalance, parsePgn, sacrificeMap, winFor } from './analysis';
import MaterialGraph from './components/MaterialGraph';
import GambitStats from './components/GambitStats';
import { saveAnalyzed } from './gambits';
import { CLASS_INFO, CLASS_ORDER, ClassIcon, fmtSan, type Notation } from './classes';
import { SAMPLES } from './samples';
import { DEFAULT_ENGINE, DEFAULT_SOUND, depthCapMs, usePersistent, type EngineSettings } from './settings';
import { play, setMuted, setVolume, soundForSan } from './sound';
import { addLine, addMove, deleteNode, newTree, promote, type VTree } from './tree';
import type { Classification, Color, MoveAnalysis, ParsedGame, PositionEval, Score } from './types';

type Tab = 'summary' | 'moves' | 'free';
const GOOD: Classification[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced'];

export default function App() {
  const [pgn, setPgn] = useState('');
  const [game, setGame] = useState<ParsedGame | null>(null);
  const [evals, setEvals] = useState<(PositionEval | undefined)[]>([]);
  const [ply, setPly] = useState(0);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [engineCfg, setEngineCfg] = usePersistent<EngineSettings>('aa.engine', DEFAULT_ENGINE);
  const [soundCfg, setSoundCfg] = usePersistent('aa.sound', DEFAULT_SOUND);
  const [prefs, setPrefs] = usePersistent<{ notation: Notation; liveLimit: number; pawnSacs: boolean }>('aa.prefs', { notation: 'figurine', liveLimit: 0, pawnSacs: true });
  const notation = prefs.notation;
  const [status, setStatus] = useState<'idle' | 'loading' | 'analyzing' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('moves');
  const [showInput, setShowInput] = useState(true);
  const [engineName, setEngineName] = useState('Stockfish');
  const [usedCfg, setUsedCfg] = useState<EngineSettings>(engineCfg);
  const engineRef = useRef<Engine | null>(null);
  const runRef = useRef(0);
  const startedAt = useRef(0);
  const loadedPgn = useRef('');
  const loadedMeta = useRef<{ id: string; userColor: Color } | null>(null);
  const [inputTab, setInputTab] = useState<'review' | 'gambits'>('review');
  const [elapsed, setElapsed] = useState(0);

  // ---- análisis libre ----
  const [tree, setTree] = useState<VTree | null>(null);
  const [cur, setCur] = useState(0);
  const [why, setWhy] = useState<WhyInfo | null>(null);
  const [live, setLive] = useState<LiveUpdate | null>(null);
  const liveRef = useRef<LiveEngine | null>(null);
  const [freeFenInput, setFreeFenInput] = useState('');

  useEffect(() => {
    setMuted(soundCfg.muted);
    setVolume(soundCfg.volume);
  }, [soundCfg]);

  const total = game?.moves.length ?? 0;
  const done = evals.filter(Boolean).length;
  const freeMode = tab === 'free' && !!tree && !showInput;

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
    async (text: string, opts: { userColor?: Color; keepView?: boolean; gameId?: string } = {}) => {
      setError('');
      let g: ParsedGame;
      try {
        g = await parsePgn(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        play('illegal');
        return;
      }
      loadedPgn.current = text;
      if (!opts.keepView) loadedMeta.current = opts.gameId && opts.userColor ? { id: opts.gameId, userColor: opts.userColor } : null;
      const cfg = engineCfg;
      setUsedCfg(cfg);
      const run = ++runRef.current;
      engineRef.current?.terminate();
      cache.current.clear();
      setGame(g);
      setEvals([]);
      if (!opts.keepView) {
        setPly(0);
        setTab('moves');
        setOrientation(opts.userColor === 'b' ? 'black' : 'white');
        setTree(null);
        setWhy(null);
      }
      setShowInput(false);
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
      const depth = cfg.mode === 'depth' ? cfg.depth : null;
      const ms = cfg.mode === 'depth' ? depthCapMs(cfg.depth) : cfg.ms;
      for (let i = 0; i <= g.moves.length; i++) {
        const fen = i === 0 ? g.startFen : g.moves[i - 1].fenAfter;
        const ev = await evaluatePosition(engine, g.startFen, ucis.slice(0, i), fen, depth, ms);
        if (run !== runRef.current) return;
        arr[i] = ev;
        setEvals([...arr]);
        setElapsed(performance.now() - startedAt.current);
      }
      setStatus('done');
      // guardar en caché el primer error del usuario (para "Mis gambitos")
      const meta = loadedMeta.current;
      if (meta) {
        try {
          const sm = sacrificeMap(g);
          const an = g.moves.map((m, i) => classifyMove(m, g.moves[i - 1], arr[i]!, arr[i + 1]!, sm[i]));
          const idx = g.moves.findIndex((m, i) => m.color === meta.userColor && ['mistake', 'blunder'].includes(an[i].classification));
          const acc = gameAccuracy(g.moves, an, arr);
          saveAnalyzed(meta.id, {
            firstError: idx >= 0 ? parseInt(g.moves[idx].fenBefore.split(' ')[5] || '1', 10) : null,
            userColor: meta.userColor,
            accuracy: acc[meta.userColor],
            at: Date.now(),
          });
        } catch {
          /* ignorar */
        }
      }
      if (!opts.keepView) setTab((t) => (t === 'moves' ? 'summary' : t));
    },
    [engineCfg],
  );

  useEffect(
    () => () => {
      engineRef.current?.terminate();
      liveRef.current?.terminate();
    },
    [],
  );

  /* ---------------- navegación de la partida ---------------- */
  const result = game?.headers.Result;
  const go = useCallback(
    (p: number) => {
      const np = Math.max(0, Math.min(total, p));
      if (game && np > ply) {
        const decisive = result === '1-0' || result === '0-1' || result === '1/2-1/2';
        play(soundForSan(game.moves[np - 1].san, np === total && decisive));
      }
      setPly(np);
    },
    [total, ply, game, result],
  );

  /* ---------------- análisis libre ---------------- */
  const curNode = tree ? tree.nodes[cur] : null;

  useEffect(() => {
    if (!freeMode || !curNode) {
      liveRef.current?.stop();
      return;
    }
    if (!liveRef.current) {
      liveRef.current = new LiveEngine(3);
    }
    const le = liveRef.current;
    le.onUpdate = (u) => setLive(u);
    setLive(null);
    if (isTerminal(curNode.fen)) {
      le.stop();
      return;
    }
    le.analyse(curNode.fen, prefs.liveLimit || null);
  }, [freeMode, curNode?.fen, prefs.liveLimit]);

  const liveLines = live && curNode && live.fen === curNode.fen ? live.lines : [];
  const liveScore: Score | undefined = useMemo(() => {
    if (!curNode) return undefined;
    const c = new Chess(curNode.fen);
    if (c.isCheckmate()) return { kind: 'mate', v: 0, mated: c.turn() };
    if (c.isStalemate() || c.isInsufficientMaterial()) return { kind: 'cp', v: 0 };
    if (!liveLines[0]) return undefined;
    return lineToWhiteScore(liveLines[0], c.turn());
  }, [curNode, liveLines]);

  const enterFree = useCallback((fen: string) => {
    const t = newTree(fen);
    setTree(t);
    setCur(t.root);
    setWhy(null);
    setTab('free');
    setShowInput(false);
  }, []);

  const currentFen = useCallback(() => {
    if (!game) return START_FEN;
    return ply > 0 ? game.moves[ply - 1].fenAfter : game.startFen;
  }, [game, ply]);

  const freeMove = useCallback(
    (uci: string) => {
      let t = tree;
      let from = cur;
      if (!freeMode || !t) {
        t = newTree(currentFen());
        from = t.root;
        setWhy(null);
        setTab('free');
        setShowInput(false);
      }
      const r = addMove(t, from, uci);
      if (!r) {
        play('illegal');
        setTree(t);
        return;
      }
      const [nt, id] = r;
      setTree(nt);
      setCur(id);
      play(soundForSan(nt.nodes[id].san!));
    },
    [tree, cur, freeMode, currentFen],
  );

  const playLine = useCallback(
    (pv: string[]) => {
      if (!tree) return;
      const [nt, ids] = addLine(tree, cur, pv);
      if (!ids.length) return;
      setTree(nt);
      setCur(ids[ids.length - 1]);
      play(soundForSan(nt.nodes[ids[ids.length - 1]].san!));
    },
    [tree, cur],
  );

  const freeGo = useCallback(
    (id: number | undefined) => {
      if (!tree || id === undefined || !tree.nodes[id]) return;
      const n = tree.nodes[id];
      // sonido solo al avanzar (el nuevo nodo es hijo del actual o descendiente)
      let x: number | null = n.parent;
      while (x !== null && x !== cur) x = tree.nodes[x].parent;
      if (x === cur && n.san) play(soundForSan(n.san));
      setCur(id);
    },
    [tree, cur],
  );

  const whyAnalyze = useCallback(
    (p: number) => {
      if (!game) return;
      const move = game.moves[p - 1];
      const an = analyses[p - 1];
      const before = evals[p - 1];
      const after = evals[p];
      let t = newTree(move.fenBefore);
      let playedIds: number[];
      let bestIds: number[] = [];
      [t, playedIds] = addLine(t, t.root, [move.uci, ...(after?.lines[0]?.pv ?? []).slice(0, 9)]);
      if (before?.lines[0]) [t, bestIds] = addLine(t, t.root, before.lines[0].pv.slice(0, 10));
      setTree(t);
      setCur(playedIds[0]);
      setWhy({
        ply: p,
        san: move.san,
        color: move.color,
        cls: an?.classification ?? 'good',
        playedIds,
        bestIds,
        bestSan: an?.bestSan,
        loss: an?.loss ?? 0,
      });
      setTab('free');
      play(soundForSan(move.san));
    },
    [game, analyses, evals],
  );

  const loadFen = useCallback(
    (fen: string) => {
      try {
        const c = new Chess(fen);
        enterFree(c.fen());
        return true;
      } catch {
        play('illegal');
        return false;
      }
    },
    [enterFree],
  );

  /* ---------------- teclado ---------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'f' || e.key === 'F') {
        setOrientation((o) => (o === 'white' ? 'black' : 'white'));
        e.preventDefault();
        return;
      }
      if (freeMode && tree) {
        const n = tree.nodes[cur];
        if (e.key === 'ArrowLeft') freeGo(n.parent ?? undefined);
        else if (e.key === 'ArrowRight') freeGo(n.children[0]);
        else if (e.key === 'ArrowUp' || e.key === 'Home') freeGo(tree.root);
        else if (e.key === 'ArrowDown' || e.key === 'End') {
          let x = n;
          while (x.children[0] !== undefined) x = tree.nodes[x.children[0]];
          freeGo(x.id);
        } else return;
        e.preventDefault();
        return;
      }
      if (!game) return;
      if (e.key === 'ArrowLeft') go(ply - 1);
      else if (e.key === 'ArrowRight') go(ply + 1);
      else if (e.key === 'ArrowUp' || e.key === 'Home') go(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') go(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, ply, total, go, freeMode, tree, cur, freeGo]);

  const loadFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setPgn(String(r.result));
    r.readAsText(f);
  };

  const pickImported = (g: ImportedGame) => {
    setPgn(g.pgn);
    setInputTab('review');
    start(g.pgn, { userColor: g.userColor, gameId: g.url ?? g.id });
  };

  /* ---------------- datos de la posición mostrada ---------------- */
  const move = game && ply > 0 ? game.moves[ply - 1] : undefined;
  const an = ply > 0 ? analyses[ply - 1] : undefined;
  let fen: string;
  let lastMove: [string, string] | undefined;
  let boardScore: Score | undefined;
  const arrows: { uci: string; brush: string }[] = [];
  let badge: { square: string; cls: Classification } | undefined;

  if (freeMode && curNode) {
    fen = curNode.fen;
    lastMove = curNode.uci ? [curNode.uci.slice(0, 2), curNode.uci.slice(2, 4)] : undefined;
    boardScore = liveScore;
    const seen = new Set<string>();
    liveLines.slice(0, 3).forEach((l, i) => {
      const u = l.pv[0];
      if (!u || seen.has(u)) return;
      seen.add(u);
      arrows.push({ uci: u, brush: i === 0 ? 'best' : i === 1 ? 'alt1' : 'alt2' });
    });
    if (why && cur === tree!.root && tree!.nodes[why.playedIds[0]]) {
      arrows.push({ uci: tree!.nodes[why.playedIds[0]].uci!, brush: 'played' });
    }
    if (why && cur === why.playedIds[0]) badge = { square: curNode.uci!.slice(2, 4), cls: why.cls };
  } else {
    fen = game ? (move ? move.fenAfter : game.startFen) : START_FEN;
    lastMove = move ? [move.from, move.to] : undefined;
    boardScore = evals[ply]?.white;
    if (an && move && !an.isBest && an.bestUci && an.classification !== 'book' && an.classification !== 'forced') {
      arrows.push({ uci: an.bestUci, brush: 'best' });
    }
    const e0 = evals[ply];
    if (!move && e0?.lines[0]) arrows.push({ uci: e0.lines[0].pv[0], brush: 'best' });
    if (move && an) badge = { square: move.to, cls: an.classification };
  }
  const inCheck = useMemo(() => {
    try {
      return new Chess(fen).inCheck();
    } catch {
      return false;
    }
  }, [fen]);

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

  const balance = useMemo(() => (game ? materialBalance(game) : []), [game]);

  type SacItem = { ply: number; color: Color; amount: number; pawn: boolean; cls: Classification; ok: boolean; comp: { held: boolean; min: number; lostBefore: boolean } | null };
  const sacrifices = useMemo(() => {
    const s: Record<Color, SacItem[]> = { w: [], b: [] };
    if (!game) return s;
    analyses.forEach((a, i) => {
      if (!a) return;
      const pawn = !a.sacrifice && a.pawnSacrifice;
      if (!a.sacrifice && !(prefs.pawnSacs && pawn)) return;
      const m = game.moves[i];
      // ¿se mantuvo la compensación? prob. de ganar del que sacrifica >= 35 % durante las ~5 jugadas siguientes
      const end = Math.min(game.moves.length, i + 1 + 10);
      let min = 100;
      let complete = true;
      for (let k = i + 1; k <= end; k++) {
        const e = evals[k];
        if (!e) { complete = false; break; }
        min = Math.min(min, winFor(e.white, m.color));
      }
      s[m.color].push({
        ply: i + 1,
        color: m.color,
        amount: pawn ? a.pawnSacAmount : a.sacrificeAmount,
        pawn,
        cls: a.classification,
        ok: GOOD.includes(a.classification),
        comp: complete ? { held: a.winBefore >= 35 && min >= 35, min, lostBefore: a.winBefore < 35 } : null,
      });
    });
    return s;
  }, [analyses, game, evals, prefs.pawnSacs]);

  const maxDown = useMemo(() => {
    const r: Record<Color, { amount: number; ply: number }> = { w: { amount: 0, ply: 0 }, b: { amount: 0, ply: 0 } };
    // un déficit solo cuenta si dura al menos 2 medias jugadas (ignora el instante entre captura y recaptura)
    balance.forEach((b, i) => {
      const next = i + 1 < balance.length ? balance[i + 1] : b;
      const wDown = Math.min(-b, -next);
      const bDown = Math.min(b, next);
      if (wDown > r.w.amount) r.w = { amount: wDown, ply: i };
      if (bDown > r.b.amount) r.b = { amount: bDown, ply: i };
    });
    return r;
  }, [balance]);

  const moveLabel = (p: number) => {
    const m = game!.moves[p - 1];
    const n = Math.ceil(p / 2);
    return `${n}${m.color === 'w' ? '.' : '...'} ${fmtSan(m.san, notation, m.color)}`;
  };

  const progressPct = total ? (done / (total + 1)) * 100 : 0;
  const busy = status === 'analyzing' || status === 'loading';

  const navFirst = () => (freeMode && tree ? freeGo(tree.root) : go(0));
  const navPrev = () => (freeMode && tree ? freeGo(tree.nodes[cur].parent ?? undefined) : go(ply - 1));
  const navNext = () => (freeMode && tree ? freeGo(tree.nodes[cur].children[0]) : go(ply + 1));
  const navLast = () => {
    if (freeMode && tree) {
      let x = tree.nodes[cur];
      while (x.children[0] !== undefined) x = tree.nodes[x.children[0]];
      freeGo(x.id);
    } else go(total);
  };

  const selectTab = (t: Tab) => {
    if (t === 'free') {
      if (!tree) enterFree(currentFen());
      else setTab('free');
    } else setTab(t);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♞</span>
          <span>Analizador de Partidas</span>
        </div>
        <div className="top-controls">
          <SoundControls value={soundCfg} onChange={setSoundCfg} />
          <label>
            Notación
            <select value={notation} onChange={(e) => setPrefs({ ...prefs, notation: e.target.value as Notation })}>
              <option value="figurine">Figuras (♘f3)</option>
              <option value="es">Española (Cf3)</option>
              <option value="en">Inglesa (Nf3)</option>
            </select>
          </label>
          {(game || tree) && (
            <button className="btn ghost" onClick={() => setShowInput((s) => !s)} data-testid="new-game">
              {showInput ? 'Volver al análisis' : '＋ Nueva partida'}
            </button>
          )}
        </div>
        {busy && <div className="top-progress" style={{ width: `${progressPct}%` }} />}
      </header>

      <main className="layout">
        <section className="board-area">
          <PlayerBar name={players[topColor].name} elo={players[topColor].elo} color={topColor} acc={freeMode ? null : accuracy[topColor]} />
          <div className="board-row">
            <EvalBar score={boardScore} orientation={orientation} />
            <Board fen={fen} orientation={orientation} lastMove={lastMove} arrows={arrows} badge={badge} check={inCheck} onMove={freeMove} />
          </div>
          <PlayerBar name={players[botColor].name} elo={players[botColor].elo} color={botColor} acc={freeMode ? null : accuracy[botColor]} />
        </section>

        <aside className="panel">
          {showInput && (
            <div className="input-panel">
              <div className="seg top-seg">
                <button className={inputTab === 'review' ? 'on' : ''} onClick={() => setInputTab('review')} data-testid="input-review">
                  Revisar partida
                </button>
                <button className={inputTab === 'gambits' ? 'on' : ''} onClick={() => setInputTab('gambits')} data-testid="input-gambits">
                  Mis gambitos
                </button>
              </div>
              {inputTab === 'gambits' && <GambitStats onPick={pickImported} />}
              {inputTab === 'review' && (<>
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
                    {['Ejemplo: Ópera de Morphy', 'Ejemplo: Partida del siglo', 'Ejemplo: Partida inmortal (gambito)'][i]}
                  </button>
                ))}
              </div>
              <EngineControls value={engineCfg} onChange={setEngineCfg} />
              <button className="btn primary big" disabled={!pgn.trim()} onClick={() => start(pgn)} data-testid="analyze">
                Analizar partida
              </button>
              {error && <div className="error">{error}</div>}
              <h3>Análisis libre</h3>
              <p className="muted">Mueve las piezas tú mismo y Stockfish te muestra las 3 mejores líneas en tiempo real. También puedes arrastrar una pieza en el tablero directamente.</p>
              <div className="row wrap">
                <button className="btn ghost" onClick={() => enterFree(START_FEN)} data-testid="free-start">
                  Desde la posición inicial
                </button>
              </div>
              <form className="import-row" onSubmit={(e) => { e.preventDefault(); if (loadFen(freeFenInput.trim())) setFreeFenInput(''); else setError('FEN no válido.'); }}>
                <input value={freeFenInput} onChange={(e) => setFreeFenInput(e.target.value)} placeholder="…o pega un FEN" data-testid="free-fen" />
                <button className="btn" type="submit" disabled={!freeFenInput.trim()}>Analizar FEN</button>
              </form>
              </>)}
            </div>
          )}

          {!showInput && (game || tree) && (
            <>
              <div className="tabs">
                {game && (
                  <>
                    <button className={tab === 'summary' ? 'on' : ''} onClick={() => selectTab('summary')} data-testid="tab-summary">
                      Resumen
                    </button>
                    <button className={tab === 'moves' ? 'on' : ''} onClick={() => selectTab('moves')} data-testid="tab-moves">
                      Análisis
                    </button>
                  </>
                )}
                <button className={tab === 'free' ? 'on' : ''} onClick={() => selectTab('free')} data-testid="tab-free">
                  Análisis libre
                </button>
              </div>

              {game && tab !== 'free' && (
                <div className="engine-bar">
                  <EngineControls
                    value={engineCfg}
                    onChange={setEngineCfg}
                    positions={total + 1}
                    onReanalyze={() => start(loadedPgn.current, { keepView: true })}
                    busy={false}
                    compact
                  />
                </div>
              )}

              {busy && tab !== 'free' && (
                <div className="progress" data-testid="progress">
                  <div className="progress-text">
                    {status === 'loading'
                      ? 'Cargando Stockfish…'
                      : `Analizando… ${done}/${total + 1} posiciones · ${usedCfg.mode === 'depth' ? `profundidad ${usedCfg.depth}` : `${usedCfg.ms / 1000} s por jugada`}`}
                  </div>
                  <div className="bar">
                    <div style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              )}
              {error && <div className="error">{error}</div>}

              {game && tab === 'summary' && (
                <div className="summary" data-testid="summary">
                  <div className="game-title">
                    <strong>{players.w.name}</strong> vs <strong>{players.b.name}</strong>
                    <span className="muted"> · {h.Result ?? ''} {h.Date && h.Date !== '????.??.??' ? '· ' + h.Date.replace(/\./g, '/') : ''}</span>
                    {game.opening && <div className="opening">📖 {game.opening}</div>}
                  </div>
                  <EvalGraph evals={evals} analyses={analyses} total={total} ply={ply} onSelect={(p) => go(p)} height={80} />
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
                    <div className="sacs-head">
                      <h3>Sacrificios</h3>
                      <label className="toggle" title="Contar también los peones entregados a propósito">
                        <input type="checkbox" checked={prefs.pawnSacs} onChange={(e) => setPrefs({ ...prefs, pawnSacs: e.target.checked })} data-testid="pawn-sacs" />
                        <span className="toggle-track"><span /></span>
                        Incluir peones (gambitos)
                      </label>
                    </div>
                    <p className="muted small">
                      Jugadas que entregan material {prefs.pawnSacs ? '(piezas o peones)' : '(≥ 2 puntos)'} sin recuperarlo de inmediato.
                      «Compensación» = el bando que sacrifica mantiene ≥ 35 % de prob. de ganar durante las 5 jugadas siguientes.
                    </p>
                    <div className="mat-head small muted">Balance de material (blancas − negras)</div>
                    <MaterialGraph
                      balance={balance}
                      ply={ply}
                      onSelect={(p) => go(p)}
                      marks={[...sacrifices.w, ...sacrifices.b].map((x) => ({ ply: x.ply, ok: x.comp ? x.comp.held : null }))}
                    />
                    <div className="sac-cols">
                      {(['w', 'b'] as Color[]).map((c) => {
                        const list = sacrifices[c];
                        const held = list.filter((x) => x.comp?.held).length;
                        const judged = list.filter((x) => x.comp && !x.comp.lostBefore).length;
                        return (
                          <div key={c} className="sac-col" data-testid={'sac-col-' + c}>
                            <div className="sac-head">{players[c].name}</div>
                            <div className="sac-stats">
                              <button className="link" onClick={() => go(maxDown[c].ply)} data-testid={'maxdown-' + c}>
                                Máximo material abajo: <strong>{maxDown[c].amount > 0 ? `−${maxDown[c].amount}` : '0'}</strong>
                              </button>
                              {judged > 0 && (
                                <span>
                                  Compensación mantenida: <strong>{held}/{judged}</strong>
                                </span>
                              )}
                            </div>
                            {list.length === 0 && <div className="muted small">Ninguno</div>}
                            {list.map((s) => (
                              <button key={s.ply} className={'sac ' + (s.ok ? 'ok' : 'bad')} onClick={() => { setPly(s.ply); setTab('moves'); }} data-testid="sac-item">
                                <ClassIcon cls={s.cls} size={16} />
                                <span className="sac-move">
                                  {moveLabel(s.ply)} {s.pawn && <span className="sac-tag">{s.amount > 1 ? `${s.amount} peones` : 'peón'}</span>}
                                </span>
                                <span className="sac-amt">−{s.amount}</span>
                                <span className="sac-verdict">{s.ok ? 'Correcto' : 'Incorrecto'} · {CLASS_INFO[s.cls].label}</span>
                                <span className={'sac-comp ' + (s.comp ? (s.comp.lostBefore ? '' : s.comp.held ? 'held' : 'lost') : '')}>
                                  {!s.comp
                                    ? 'Compensación: analizando…'
                                    : s.comp.lostBefore
                                      ? 'Compensación: — (la posición ya estaba perdida)'
                                      : s.comp.held
                                        ? `✓ Compensación (mín. ${s.comp.min.toFixed(0)} %)`
                                        : `✗ Sin compensación (cayó a ${s.comp.min.toFixed(0)} %)`}
                                </span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button className="btn primary big full" onClick={() => { setTab('moves'); if (ply === 0) go(1); }}>
                    Revisar jugada por jugada
                  </button>
                  <div className="engine-note muted small">
                    Motor: {engineName} (WASM lite, 1 hilo) · {usedCfg.mode === 'depth' ? `profundidad ${usedCfg.depth}` : `${usedCfg.ms / 1000} s por jugada`}
                    {status === 'done' && ` · ${(elapsed / 1000).toFixed(0)} s`}
                  </div>
                </div>
              )}

              {game && tab === 'moves' && (
                <div className="review">
                  <MoveCard ply={ply} game={game} an={an} ev={evals[ply]} notation={notation} onWhy={whyAnalyze} />
                  <EvalGraph evals={evals} analyses={analyses} total={total} ply={ply} onSelect={(p) => go(p)} height={56} />
                  <MoveList game={game} analyses={analyses} ply={ply} onSelect={go} notation={notation} />
                </div>
              )}

              {freeMode && tree && (
                <FreePanel
                  tree={tree}
                  cur={cur}
                  setCur={freeGo}
                  lines={liveLines}
                  liveDepth={live?.depth ?? 0}
                  liveDone={!!live?.done}
                  limit={prefs.liveLimit}
                  setLimit={(d) => setPrefs({ ...prefs, liveLimit: d })}
                  notation={notation}
                  why={why}
                  onPlayLine={playLine}
                  onBack={game ? () => setTab('moves') : undefined}
                  onLoadFen={loadFen}
                  onDelete={(id) => { const p = tree.nodes[id].parent!; setTree(deleteNode(tree, id)); setCur(p); }}
                  onPromote={(id) => setTree(promote(tree, id))}
                  terminal={isTerminal(tree.nodes[cur].fen)}
                />
              )}

              <div className="nav">
                <button onClick={navFirst} title="Inicio (↑ / Inicio)" data-testid="nav-first">⏮</button>
                <button onClick={navPrev} title="Anterior (←)" data-testid="nav-prev">◀</button>
                <button onClick={navNext} title="Siguiente (→)" data-testid="nav-next">▶</button>
                <button onClick={navLast} title="Final (↓ / Fin)" data-testid="nav-last">⏭</button>
                <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Girar tablero (F)" data-testid="flip">⟲</button>
              </div>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
