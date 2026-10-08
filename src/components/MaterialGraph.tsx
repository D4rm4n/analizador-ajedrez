import { useRef } from 'react';

/** Gráfica del balance de material (blancas − negras) a lo largo de la partida */
export default function MaterialGraph({ balance, ply, onSelect, marks }: { balance: number[]; ply: number; onSelect: (p: number) => void; marks: { ply: number; ok: boolean | null }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = 600, H = 100;
  const n = Math.max(1, balance.length - 1);
  const maxAbs = Math.max(3, ...balance.map((b) => Math.abs(b)));
  const x = (i: number) => (i / n) * W;
  const y = (b: number) => H / 2 - (b / maxAbs) * (H / 2 - 6);
  // escalones: el material cambia en saltos
  let d = `M0,${y(balance[0])}`;
  for (let i = 1; i < balance.length; i++) d += ` H${x(i).toFixed(1)} V${y(balance[i]).toFixed(1)}`;
  const area = d + ` H${W} V${H / 2} H0 Z`;
  const click = (ev: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onSelect(Math.max(0, Math.min(n, Math.round(((ev.clientX - r.left) / r.width) * n))));
  };
  return (
    <div className="mat-graph" ref={ref} onClick={click} data-testid="material-graph" title="Balance de material (blancas − negras). Haz clic para ir a esa jugada">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
        <defs>
          <clipPath id="mg-top"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="mg-bot"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <rect width={W} height={H} fill="#24221f" />
        <path d={area} fill="#e8e6e3" opacity="0.85" clipPath="url(#mg-top)" />
        <path d={area} fill="#111" opacity="0.9" clipPath="url(#mg-bot)" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#6d6a66" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="#e0a03d" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={x(ply)} x2={x(ply)} y1="0" y2={H} stroke="#5d9bdc" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {marks.map((m) => (
        <span
          key={m.ply}
          className={'mg-dot ' + (m.ok === null ? 'pending' : m.ok ? 'ok' : 'bad')}
          style={{ left: `${(m.ply / n) * 100}%`, top: `${(y(balance[m.ply]) / H) * 100}%` }}
        />
      ))}
      <span className="mg-lbl top">+{maxAbs}</span>
      <span className="mg-lbl bot">−{maxAbs}</span>
    </div>
  );
}
