import { useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { formatScore } from '../analysis';
import { CLASS_INFO, ClassIcon, fmtLine, fmtSan, type Notation } from '../classes';
import type { Color, MoveAnalysis, ParsedGame, PositionEval } from '../types';

export function PlayerBar({ name, elo, color, acc }: { name: string; elo?: string; color: Color; acc: number | null }) {
  return (
    <div className="player-bar">
      <span className={'avatar ' + color}>{color === 'w' ? '♔' : '♚'}</span>
      <span className="pname">{name}</span>
      {elo && elo !== '?' && <span className="pelo">({elo})</span>}
      {acc !== null && <span className="pacc">{acc.toFixed(1)}%</span>}
    </div>
  );
}

export function MoveCard({ ply, game, an, ev, notation, onWhy }: { ply: number; game: ParsedGame; an?: MoveAnalysis; ev?: PositionEval; notation: Notation; onWhy: (ply: number) => void }) {
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
      {an.pawnSacrifice && (
        <div className="mc-line small">♟ Sacrificio de {an.pawnSacAmount > 1 ? `${an.pawnSacAmount} peones` : 'peón'} (gambito)</div>
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
      <div className="mc-actions">
        <button className={'btn why-btn' + (WHY_LABEL[an.classification] ? ' bad' : '')} onClick={() => onWhy(ply)} data-testid="why-btn">
          {WHY_LABEL[an.classification] ?? 'Explorar esta jugada'} · Analizar
        </button>
      </div>
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

export function MoveList({ game, analyses, ply, onSelect, notation }: { game: ParsedGame; analyses: (MoveAnalysis | undefined)[]; ply: number; onSelect: (p: number) => void; notation: Notation }) {
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

const WHY_LABEL: Partial<Record<string, string>> = {
  blunder: '¿Por qué es un error grave?',
  mistake: '¿Por qué es un error?',
  inaccuracy: '¿Por qué es una imprecisión?',
};
