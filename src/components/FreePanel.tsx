import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { VTree } from '../tree';
import type { EngineLine, Classification } from '../types';
import { fmtSan, type Notation, CLASS_INFO, ClassIcon } from '../classes';
import { formatScore, lineToWhiteScore, uciLineToSan } from '../analysis';

export interface WhyInfo {
  ply: number;
  san: string;
  color: 'w' | 'b';
  cls: Classification;
  playedIds: number[];
  bestIds: number[];
  bestSan?: string;
  loss: number;
}

/** Tokens con número de jugada para una lista de SAN desde `fen` */
function tokens(fen: string, sans: string[], notation: Notation) {
  const parts = fen.split(' ');
  let color: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w';
  let num = parseInt(parts[5] || '1', 10);
  return sans.map((s, i) => {
    const prefix = color === 'w' ? `${num}. ` : i === 0 ? `${num}… ` : '';
    const t = { prefix, label: fmtSan(s, notation, color), idx: i };
    if (color === 'b') num++;
    color = color === 'w' ? 'b' : 'w';
    return t;
  });
}

interface Props {
  tree: VTree;
  cur: number;
  setCur: (id: number) => void;
  lines: EngineLine[];
  liveDepth: number;
  liveDone: boolean;
  limit: number; // 0 = infinito
  setLimit: (d: number) => void;
  notation: Notation;
  why: WhyInfo | null;
  onPlayLine: (pv: string[]) => void;
  onBack?: () => void;
  onLoadFen: (fen: string) => boolean;
  onDelete: (id: number) => void;
  onPromote: (id: number) => void;
  terminal: string | null;
}

export default function FreePanel(p: Props) {
  const node = p.tree.nodes[p.cur];
  const fen = node.fen;
  const stm = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const [fenInput, setFenInput] = useState('');
  const [msg, setMsg] = useState('');
  const fenRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMsg(''), [p.cur]);

  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(fen);
      setMsg('FEN copiado ✓');
    } catch {
      fenRef.current?.select();
      const ok = document.execCommand('copy');
      setMsg(ok ? 'FEN copiado ✓' : 'Selecciona y copia el FEN manualmente');
    }
  };

  return (
    <div className="free" data-testid="free-panel">
      <div className="free-head">
        <span className="free-title">Análisis libre</span>
        <label className="free-limit" title="Profundidad máxima del análisis continuo">
          <select value={p.limit} onChange={(e) => p.setLimit(parseInt(e.target.value, 10))} data-testid="live-limit">
            <option value={0}>Profundidad ∞</option>
            <option value={16}>Hasta prof. 16</option>
            <option value={20}>Hasta prof. 20</option>
            <option value={24}>Hasta prof. 24</option>
            <option value={30}>Hasta prof. 30</option>
          </select>
        </label>
        {p.onBack && (
          <button className="btn ghost small-btn" onClick={p.onBack} data-testid="back-to-game">
            ← Volver a la partida
          </button>
        )}
      </div>

      {p.why && (
        <div className="why-box" data-testid="why-box" style={{ borderColor: CLASS_INFO[p.why.cls].color }}>
          <div className="why-title">
            <ClassIcon cls={p.why.cls} size={18} />
            <span>
              {Math.ceil(p.why.ply / 2)}
              {p.why.color === 'w' ? '. ' : '… '}
              {fmtSan(p.why.san, p.notation, p.why.color)} {CLASS_INFO[p.why.cls].phrase}
              {p.why.loss >= 0.5 && <span className="muted"> (−{p.why.loss.toFixed(1)}%)</span>}
            </span>
          </div>
          <WhyLine label="Lo que pasa tras la jugada:" ids={p.why.playedIds} p={p} kind="played" />
          {p.why.bestIds.length > 0 && p.why.bestIds[0] !== p.why.playedIds[0] && (
            <WhyLine label="Lo mejor era:" ids={p.why.bestIds} p={p} kind="best" />
          )}
        </div>
      )}

      <div className="live-lines" data-testid="live-lines">
        <div className="ll-head">
          <span>Mejores líneas (Stockfish)</span>
          <span className="muted small" data-testid="live-depth">
            {p.terminal ? p.terminal : p.lines.length ? `prof. ${p.liveDepth}${p.liveDone ? '' : '…'}` : 'calculando…'}
          </span>
        </div>
        {!p.terminal &&
          [0, 1, 2].map((i) => {
            const l = p.lines[i];
            if (!l) return <div key={i} className="ll-row empty" />;
            const sans = uciLineToSan(fen, l.pv, 12);
            const sc = lineToWhiteScore(l, stm);
            const whiteAhead = sc.kind === 'mate' ? sc.v > 0 : sc.v >= 0;
            return (
              <div key={i} className="ll-row" data-testid="live-line">
                <span className={'eval-chip ' + (whiteAhead ? 'w' : 'b')}>{formatScore(sc)}</span>
                <span className="ll-moves">
                  {tokens(fen, sans, p.notation).map((t) => (
                    <button key={t.idx} className="tok" onClick={() => p.onPlayLine(l.pv.slice(0, t.idx + 1))} title="Jugar hasta aquí">
                      {t.prefix}
                      {t.label}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
      </div>

      <TreeView tree={p.tree} cur={p.cur} setCur={p.setCur} notation={p.notation} />
      {node.parent !== null && (
        <div className="tree-actions">
          <button className="link" onClick={() => p.onPromote(p.cur)} data-testid="promote">★ Hacer línea principal</button>
          <button className="link danger" onClick={() => p.onDelete(p.cur)} data-testid="delete-node">✕ Borrar desde aquí</button>
        </div>
      )}

      <div className="fen-box">
        <div className="fen-row">
          <span className="fen-label">FEN</span>
          <input ref={fenRef} readOnly value={fen} onFocus={(e) => e.target.select()} data-testid="fen-current" />
          <button className="btn small-btn" onClick={copyFen} data-testid="fen-copy">Copiar</button>
        </div>
        <form
          className="fen-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (p.onLoadFen(fenInput.trim())) {
              setFenInput('');
              setMsg('Posición cargada ✓');
            } else setMsg('FEN no válido');
          }}
        >
          <span className="fen-label" />
          <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} placeholder="Pega un FEN para analizarlo…" data-testid="fen-input" />
          <button className="btn small-btn" type="submit" disabled={!fenInput.trim()} data-testid="fen-load">Cargar</button>
        </form>
        {msg && <div className="small muted fen-msg">{msg}</div>}
      </div>
    </div>
  );
}


function WhyLine({ label, ids, p, kind }: { label: string; ids: number[]; p: Props; kind: 'played' | 'best' }) {
  if (!ids.length || !p.tree.nodes[ids[0]]) return null;
  const startFen = p.tree.nodes[p.tree.nodes[ids[0]].parent!].fen;
  const valid = ids.filter((id) => p.tree.nodes[id]);
  const sans = valid.map((id) => p.tree.nodes[id].san!);
  return (
    <div className={'why-line ' + kind}>
      <span className="muted">{label}</span>{' '}
      {tokens(startFen, sans, p.notation).map((t) => (
        <button key={t.idx} className={'tok' + (valid[t.idx] === p.cur ? ' cur' : '') + (t.idx === 0 ? ' first' : '')} onClick={() => p.setCur(valid[t.idx])} data-testid={'why-' + kind}>
          {t.prefix}
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TreeView({ tree, cur, setCur, notation }: { tree: VTree; cur: number; setCur: (id: number) => void; notation: Notation }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.tnode.cur') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  const root = tree.nodes[tree.root];

  const label = (id: number, forceNum: boolean) => {
    const n = tree.nodes[id];
    const parentFen = tree.nodes[n.parent!].fen;
    const num = parseInt(parentFen.split(' ')[5] || '1', 10);
    const prefix = n.color === 'w' ? `${num}. ` : forceNum ? `${num}… ` : '';
    return (
      <button key={id} className={'tnode' + (id === cur ? ' cur' : '')} onClick={() => setCur(id)} data-testid="tree-node">
        {prefix}
        {fmtSan(n.san, notation, n.color)}
      </button>
    );
  };

  const line = (firstId: number, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let id: number | undefined = firstId;
    let forceNum = true;
    while (id !== undefined) {
      const n: (typeof tree.nodes)[number] = tree.nodes[id];
      out.push(label(id, forceNum));
      forceNum = false;
      const parent = tree.nodes[n.parent!];
      if (parent.children[0] === id && parent.children.length > 1) {
        for (const alt of parent.children.slice(1)) {
          out.push(
            <span key={'v' + alt} className={'variation d' + Math.min(depth, 3)}>
              ({line(alt, depth + 1)})
            </span>,
          );
        }
        forceNum = true;
      }
      id = n.children[0];
    }
    return out;
  };

  return (
    <div className="tree" ref={ref} data-testid="tree">
      <button className={'tnode root' + (cur === tree.root ? ' cur' : '')} onClick={() => setCur(tree.root)}>
        Posición inicial del análisis
      </button>
      {root.children.length === 0 ? (
        <div className="muted small tree-empty">Mueve una pieza en el tablero para crear una variante.</div>
      ) : (
        <div className="tree-moves">{line(root.children[0], 0)}</div>
      )}
    </div>
  );
}

export function isTerminal(fen: string): string | null {
  try {
    const c = new Chess(fen);
    if (c.isCheckmate()) return 'Jaque mate';
    if (c.isStalemate()) return 'Rey ahogado (tablas)';
    if (c.isInsufficientMaterial()) return 'Material insuficiente (tablas)';
  } catch {
    return 'FEN no válido';
  }
  return null;
}
