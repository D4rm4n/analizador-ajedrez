import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
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
}

export default function Board({ fen, orientation, lastMove, arrows, badge, check }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      fen,
      orientation,
      coordinates: true,
      viewOnly: false,
      movable: { free: false, color: undefined },
      draggable: { enabled: false },
      selectable: { enabled: false },
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: {
        enabled: true,
        visible: true,
        brushes: {
          best: { key: 'best', color: '#58a733', opacity: 0.95, lineWidth: 14 },
          played: { key: 'played', color: '#e8a33d', opacity: 0.7, lineWidth: 10 },
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
      lastMove: lastMove as Key[] | undefined,
      check: check ? (fen.split(' ')[1] === 'w' ? 'white' : 'black') : false,
    });
    api.current?.setAutoShapes(shapes);
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], JSON.stringify(arrows), check]);

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
      <div ref={el} className="cg-container" />
      {badge && (
        <div className="square-badge" style={badgeStyle} key={badge.square + badge.cls}>
          <ClassIcon cls={badge.cls} size={30} />
        </div>
      )}
    </div>
  );
}
