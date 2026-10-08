import { useRef } from 'react';
import type { MoveAnalysis, PositionEval } from '../types';
import { scoreToWhiteWin } from '../analysis';
import { CLASS_INFO } from '../classes';

interface Props {
  evals: (PositionEval | undefined)[];
  analyses: (MoveAnalysis | undefined)[];
  total: number; // número de jugadas
  ply: number;
  onSelect: (ply: number) => void;
  height?: number;
}

const W = 600;

export default function EvalGraph({ evals, analyses, total, ply, onSelect, height = 90 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const H = 100;
  const n = Math.max(1, total);
  const x = (i: number) => (i / n) * W;
  const y = (i: number) => {
    const e = evals[i];
    const w = e ? scoreToWhiteWin(e.white) : 50;
    return H - (w / 100) * H;
  };
  const known: number[] = [];
  for (let i = 0; i <= total; i++) if (evals[i]) known.push(i);
  let area = '';
  let line = '';
  if (known.length) {
    line = known.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(i).toFixed(1)}`).join(' ');
    area = `M${x(known[0])},${H} ` + known.map((i) => `L${x(i).toFixed(1)},${y(i).toFixed(1)}`).join(' ') + ` L${x(known[known.length - 1])},${H} Z`;
  }
  const marks = analyses
    .map((a, i) => ({ a, ply: i + 1 }))
    .filter(({ a }) => a && ['brilliant', 'great', 'mistake', 'blunder', 'inaccuracy'].includes(a.classification));

  const click = (ev: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const f = (ev.clientX - r.left) / r.width;
    onSelect(Math.max(0, Math.min(total, Math.round(f * n))));
  };

  return (
    <div className="eval-graph" ref={ref} onClick={click} style={{ height }} data-testid="eval-graph" title="Haz clic para ir a esa jugada">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
        <rect x="0" y="0" width={W} height={H} fill="#403d39" />
        {area && <path d={area} fill="#f0f0f0" />}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#8a8784" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {line && <path d={line} fill="none" stroke="#81b64c" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
        <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#5d9bdc" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {marks.map(({ a, ply: p }) => (
        <span
          key={p}
          className="graph-dot"
          style={{ left: `${(p / n) * 100}%`, top: `${(y(p) / H) * 100}%`, background: CLASS_INFO[a!.classification].color }}
        />
      ))}
    </div>
  );
}
