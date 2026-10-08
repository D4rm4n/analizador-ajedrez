import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Chess } from 'chess.js';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import type { Classification } from '../types';
import { CLASS_INFO, ClassIcon } from '../classes';

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [string, string];
  arrows: { uci: string; brush: string }[];
  badge?: { square: string; cls: Classification };
  check?: boolean;
  /** si se indica, el usuario puede mover las piezas del bando que juega */
  onMove?: (uci: string) => void;
}

const PROMO = [
  { p: 'q', w: '♕', b: '♛', name: 'Dama' },
  { p: 'r', w: '♖', b: '♜', name: 'Torre' },
  { p: 'b', w: '♗', b: '♝', name: 'Alfil' },
  { p: 'n', w: '♘', b: '♞', name: 'Caballo' },
];

export default function Board({ fen, orientation, lastMove, arrows, badge, check, onMove }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [promo, setPromo] = useState<{ from: string; to: string; color: 'w' | 'b' } | null>(null);
  const [reset, setReset] = useState(0);
  const fenRef = useRef(fen);
  fenRef.current = fen;

  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    try {
      const c = new Chess(fen);
      for (const mv of c.moves({ verbose: true })) {
        const arr = m.get(mv.from as Key) ?? [];
        if (!arr.includes(mv.to as Key)) arr.push(mv.to as Key);
        m.set(mv.from as Key, arr);
      }
    } catch {
      /* FEN inválido */
    }
    return m;
  }, [fen]);
  const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const c = new Chess(fenRef.current);
            const piece = c.get(orig as never);
            if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
              setPromo({ from: orig, to: dest, color: piece.color });
              return;
            }
            onMoveRef.current?.(orig + dest);
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      drawable: {
        enabled: true,
        visible: true,
        brushes: {
          best: { key: 'best', color: '#58a733', opacity: 0.95, lineWidth: 14 },
          alt1: { key: 'alt1', color: '#3b82c4', opacity: 0.75, lineWidth: 10 },
          alt2: { key: 'alt2', color: '#3b82c4', opacity: 0.45, lineWidth: 8 },
          played: { key: 'played', color: '#e0402f', opacity: 0.85, lineWidth: 11 },
          green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
          red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
          blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
          yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
        },
      },
    });
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const shapes: DrawShape[] = arrows.map((a) => ({
      orig: a.uci.slice(0, 2) as Key,
      dest: a.uci.slice(2, 4) as Key,
      brush: a.brush,
    }));
    api.current?.set({
      fen,
      orientation,
      turnColor: turn,
      lastMove: lastMove as Key[] | undefined,
      check: check ? turn : false,
      movable: { color: onMove ? turn : undefined, dests: onMove ? dests : new Map() },
    });
    api.current?.setAutoShapes(shapes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], JSON.stringify(arrows), check, !!onMove, dests, reset]);

  let badgeStyle: React.CSSProperties | undefined;
  if (badge) {
    const f = badge.square.charCodeAt(0) - 97;
    const r = parseInt(badge.square[1], 10);
    const col = orientation === 'white' ? f : 7 - f;
    const row = orientation === 'white' ? 8 - r : r - 1;
    badgeStyle = { left: `calc(${(col + 1) * 12.5}% - 2.6%)`, top: `calc(${row * 12.5}% - 1.6%)` };
  }
  const lmColor = badge ? CLASS_INFO[badge.cls].color : undefined;

  return (
    <div className="board-wrap" style={{ ['--lm' as string]: lmColor ? lmColor + '99' : 'rgba(255,255,51,.45)' }}>
      <div ref={el} className="cg-container" data-testid="board" />
      {badge && (
        <div className="square-badge" style={badgeStyle} key={badge.square + badge.cls}>
          <ClassIcon cls={badge.cls} size={30} />
        </div>
      )}
      {promo && (
        <div className="promo-overlay" onClick={() => { setPromo(null); setReset((r) => r + 1); }}>
          <div className="promo-box" onClick={(e) => e.stopPropagation()} data-testid="promo-dialog">
            <div className="promo-title">Coronar peón</div>
            <div className="promo-row">
              {PROMO.map((p) => (
                <button
                  key={p.p}
                  title={p.name}
                  data-testid={'promo-' + p.p}
                  onClick={() => {
                    const pr = promo;
                    setPromo(null);
                    onMoveRef.current?.(pr.from + pr.to + p.p);
                  }}
                >
                  {promo.color === 'w' ? p.w : p.b}
                </button>
              ))}
            </div>
            <button className="promo-cancel" onClick={() => { setPromo(null); setReset((r) => r + 1); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
