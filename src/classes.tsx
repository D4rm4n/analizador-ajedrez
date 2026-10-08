import type { Classification } from './types';

export const CLASS_INFO: Record<Classification, { label: string; phrase: string; color: string; symbol: string }> = {
  brilliant: { label: 'Brillante', phrase: 'es una jugada brillante', color: '#26c2a3', symbol: '!!' },
  great: { label: 'Gran jugada', phrase: 'es una gran jugada', color: '#5c8bb0', symbol: '!' },
  best: { label: 'Mejor jugada', phrase: 'es la mejor jugada', color: '#81b64c', symbol: '★' },
  excellent: { label: 'Excelente', phrase: 'es excelente', color: '#96bc4b', symbol: '👍' },
  good: { label: 'Buena', phrase: 'es una buena jugada', color: '#96af8b', symbol: '✓' },
  book: { label: 'Libro', phrase: 'es una jugada de libro', color: '#a88865', symbol: '📖' },
  inaccuracy: { label: 'Imprecisión', phrase: 'es una imprecisión', color: '#f7c631', symbol: '?!' },
  mistake: { label: 'Error', phrase: 'es un error', color: '#ffa459', symbol: '?' },
  blunder: { label: 'Error grave', phrase: 'es un error grave', color: '#fa412d', symbol: '??' },
  forced: { label: 'Forzada', phrase: 'es una jugada forzada', color: '#97a1a8', symbol: '→' },
};

export const CLASS_ORDER: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'forced',
];

const PATHS: Partial<Record<Classification, string>> = {
  best: 'M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 16.8l-5.4 3 1.2-6.1-4.5-4.2 6.1-.7z',
  excellent:
    'M5.5 10.5h2.6v8.3H5.5zM9.4 18.8V10.6l3.3-5.1c.4-.6 1.3-.7 1.8-.1.3.3.4.8.3 1.2l-.8 3.2h4c1 0 1.7.9 1.5 1.9l-1.2 5.6c-.2.9-1 1.5-1.9 1.5z',
  good: 'M9.6 16.4l-4-4 1.6-1.6 2.4 2.4 7.2-7.2 1.6 1.6z',
  book: 'M5 5.5c1.9-.8 4.6-.8 6.4.6v12.3c-1.8-1.2-4.5-1.3-6.4-.6zM12.6 6.1c1.8-1.4 4.5-1.4 6.4-.6v12.3c-1.9-.7-4.6-.6-6.4.6z',
  forced: 'M4.5 11h10.3l-3.6-3.6 1.6-1.6 6.4 6.2-6.4 6.2-1.6-1.6 3.6-3.6H4.5z',
};

export function ClassIcon({ cls, size = 18 }: { cls: Classification; size?: number }) {
  const info = CLASS_INFO[cls];
  const path = PATHS[cls];
  return (
    <svg className="class-icon" width={size} height={size} viewBox="0 0 24 24" aria-label={info.label}>
      <title>{info.label}</title>
      <circle cx="12" cy="12" r="12" fill={info.color} />
      {path ? (
        <path d={path} fill="#fff" />
      ) : (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={info.symbol.length > 1 ? 12 : 15}
          fontWeight="900"
          fontFamily="Arial, Helvetica, sans-serif"
          fill="#fff"
          letterSpacing={info.symbol.length > 1 ? -1 : 0}
        >
          {info.symbol}
        </text>
      )}
    </svg>
  );
}

/* Notación */
export type Notation = 'figurine' | 'es' | 'en';
const FIG_W: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const FIG_B: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
const ES: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };

export function fmtSan(san: string | undefined, notation: Notation, color: 'w' | 'b' = 'w'): string {
  if (!san) return '';
  if (notation === 'en') return san;
  if (notation === 'es') return san.replace(/[KQRBN]/g, (p) => ES[p]);
  const map = color === 'w' ? FIG_W : FIG_B;
  return san.replace(/^[KQRBN]/, (p) => map[p]).replace(/=([QRBN])/, (_, p) => '=' + map[p]);
}

/** Formatea una línea de SAN alternando colores, con números de jugada */
export function fmtLine(sans: string[], startFen: string, notation: Notation): string {
  const parts = startFen.split(' ');
  let color: 'w' | 'b' = parts[1] === 'b' ? 'b' : 'w';
  let num = parseInt(parts[5] || '1', 10);
  const out: string[] = [];
  sans.forEach((s, i) => {
    if (color === 'w') out.push(`${num}.`);
    else if (i === 0) out.push(`${num}...`);
    out.push(fmtSan(s, notation, color));
    if (color === 'b') num++;
    color = color === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}
