import { useMemo, useState } from 'react';
import { fetchChessCom, fetchLichess, type ImportedGame } from './Importer';
import { GAMBITS, detectGambit, loadAnalyzed, shortOpening } from '../gambits';

interface Rec { n: number; w: number; d: number; l: number }
const empty = (): Rec => ({ n: 0, w: 0, d: 0, l: 0 });
const pct = (r: Rec) => (r.n ? Math.round((r.w / r.n) * 100) : 0);
const RES = { win: 'V', loss: 'D', draw: 'T', other: '—' } as const;

export default function GambitStats({ onPick }: { onPick: (g: ImportedGame) => void }) {
  const [users, setUsers] = useState({ chesscom: 'Chesster9212', lichess: 'LorDarman' });
  const [games, setGames] = useState<ImportedGame[] | null>(null);
  const [loading, setLoading] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [counts, setCounts] = useState({ chesscom: 0, lichess: 0 });
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    setGames(null);
    setErrors([]);
    const errs: string[] = [];
    const all: ImportedGame[] = [];
    const c = { chesscom: 0, lichess: 0 };
    if (users.chesscom.trim()) {
      setLoading('Descargando partidas de chess.com (últimos 3 meses)…');
      try {
        const g = await fetchChessCom(users.chesscom, 2000, 3);
        c.chesscom = g.length;
        all.push(...g);
      } catch (e) {
        errs.push('chess.com: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (users.lichess.trim()) {
      setLoading('Descargando las últimas 100 partidas de Lichess…');
      try {
        const g = await fetchLichess(users.lichess, 100);
        c.lichess = g.length;
        all.push(...g);
      } catch (e) {
        errs.push('Lichess: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    setCounts(c);
    setErrors(errs);
    setGames(all.sort((a, b) => b.date.getTime() - a.date.getTime()));
    setLoading('');
  };

  const stats = useMemo(() => {
    if (!games) return null;
    const analyzed = loadAnalyzed();
    const map = new Map<string, { total: Rec; w: Rec; b: Rec; games: (ImportedGame & { variant?: string })[]; errs: number[]; analyzed: number }>();
    for (const def of GAMBITS) map.set(def.key, { total: empty(), w: empty(), b: empty(), games: [], errs: [], analyzed: 0 });
    for (const g of games) {
      if (g.result === 'other') continue;
      const [key, variant] = detectGambit(g);
      const s = map.get(key)!;
      for (const r of [s.total, s[g.userColor]]) {
        r.n++;
        if (g.result === 'win') r.w++;
        else if (g.result === 'draw') r.d++;
        else r.l++;
      }
      s.games.push({ ...g, variant });
      const a = analyzed[g.url ?? g.id];
      if (a) {
        s.analyzed++;
        if (a.firstError !== null) s.errs.push(a.firstError);
      }
    }
    return map;
  }, [games]);

  return (
    <div className="gambits" data-testid="gambits">
      <p className="muted">Estadísticas de tus gambitos en tus partidas recientes (chess.com: últimos 3 meses · Lichess: últimas 100). No hace falta el motor.</p>
      <div className="g-users">
        <label>
          Chess.com
          <input value={users.chesscom} onChange={(e) => setUsers({ ...users, chesscom: e.target.value })} data-testid="g-user-cc" />
        </label>
        <label>
          Lichess
          <input value={users.lichess} onChange={(e) => setUsers({ ...users, lichess: e.target.value })} data-testid="g-user-li" />
        </label>
        <button className="btn primary" onClick={load} disabled={!!loading} data-testid="g-load">
          {loading ? 'Cargando…' : games ? '↻ Actualizar' : 'Cargar estadísticas'}
        </button>
      </div>
      {loading && <div className="muted small">{loading}</div>}
      {errors.map((e) => (
        <div key={e} className="error">{e}</div>
      ))}
      {stats && (
        <>
          <div className="small muted" data-testid="g-counts">
            {counts.chesscom} partidas de chess.com · {counts.lichess} de Lichess
          </div>
          <div className="g-list">
            {GAMBITS.map((def) => {
              const s = stats.get(def.key)!;
              if (s.total.n === 0 && def.key !== 'none' && def.key !== 'other') {
                return (
                  <div key={def.key} className="g-card empty" data-testid="g-card">
                    <div className="g-title">{def.name} <span className="muted small">{def.desc}</span></div>
                    <div className="muted small">Sin partidas en este periodo.</div>
                  </div>
                );
              }
              if (s.total.n === 0) return null;
              const avgErr = s.errs.length ? s.errs.reduce((a, b) => a + b, 0) / s.errs.length : null;
              const isOpen = open === def.key;
              const variants = new Map<string, number>();
              if (def.key === 'other') s.games.forEach((g) => variants.set(shortOpening(g.variant), (variants.get(shortOpening(g.variant)) ?? 0) + 1));
              return (
                <div key={def.key} className={'g-card' + (def.key === 'none' ? ' none' : '')} data-testid="g-card" data-key={def.key}>
                  <div className="g-title">
                    {def.name} <span className="muted small">{def.desc}</span>
                    <span className="g-total">
                      {s.total.n} {s.total.n === 1 ? 'partida' : 'partidas'} · <strong>{pct(s.total)} %</strong> victorias
                    </span>
                  </div>
                  <WdlBar r={s.total} />
                  <div className="g-colors">
                    {(['w', 'b'] as const).map((c) => {
                      const r = s[c];
                      const mine = def.key !== 'other' && def.key !== 'none' && def.side === c;
                      return (
                        <div key={c} className={'g-color ' + c + (mine ? ' mine' : '') + (r.n ? '' : ' zero')} data-testid={'g-color-' + c}>
                          <div className="g-color-head">
                            <span className={'dot ' + (c === 'w' ? 'dot-w' : 'dot-b')} /> Con {c === 'w' ? 'blancas' : 'negras'}
                            {mine && <span className="g-mine">tu gambito</span>}
                          </div>
                          <div className="g-pct">{r.n ? `${pct(r)} %` : '—'}</div>
                          <div className="g-wdl">{r.n ? `${r.n} part. · ${r.w}V ${r.d}T ${r.l}D` : 'sin partidas'}</div>
                        </div>
                      );
                    })}
                  </div>
                  {def.key === 'other' && (
                    <div className="small muted g-variants">
                      {[...variants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v || '¿?'} (${n})`).join(' · ')}
                    </div>
                  )}
                  {def.key !== 'none' && (
                    <div className="small g-err" data-testid="g-err">
                      {avgErr !== null
                        ? <>Tu primer error suele llegar hacia la <strong>jugada {avgErr.toFixed(0)}</strong> ({s.errs.length} de {s.analyzed} partidas analizadas)</>
                        : s.analyzed
                          ? <>Sin errores en {s.analyzed} {s.analyzed === 1 ? 'partida analizada' : 'partidas analizadas'} 👏</>
                          : <span className="muted">Analiza alguna de estas partidas para ver cuándo sueles cometer tu primer error.</span>}
                    </div>
                  )}
                  <button className="link" onClick={() => setOpen(isOpen ? null : def.key)} data-testid="g-toggle">
                    {isOpen ? '▾ Ocultar partidas' : `▸ Ver partidas (${s.games.length})`}
                  </button>
                  {isOpen && (
                    <ul className="g-games">
                      {s.games.slice(0, 60).map((g) => (
                        <li key={g.site + g.id}>
                          <button className="game-item" onClick={() => onPick(g)} data-testid="g-game">
                            <span className={'res res-' + g.result}>{RES[g.result]}</span>
                            <span className="gi-main">
                              <span className="gi-opp">
                                <span className={'dot ' + (g.userColor === 'w' ? 'dot-w' : 'dot-b')} /> vs {g.opponent}
                                {g.opponentElo ? <em>({g.opponentElo})</em> : null}
                              </span>
                              <span className="gi-meta">
                                {g.site === 'chesscom' ? 'Chess.com' : 'Lichess'} · {g.date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} · {g.speed} {g.timeControl}
                                {g.variant ? ` · ${shortOpening(g.variant)}` : ''}
                              </span>
                            </span>
                            <span className="gi-go">Analizar ›</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function WdlBar({ r }: { r: Rec }) {
  if (!r.n) return null;
  return (
    <div className="wdl-bar" title={`${r.w} victorias · ${r.d} tablas · ${r.l} derrotas`}>
      <span className="w" style={{ width: `${(r.w / r.n) * 100}%` }}>{r.w || ''}</span>
      <span className="d" style={{ width: `${(r.d / r.n) * 100}%` }}>{r.d || ''}</span>
      <span className="l" style={{ width: `${(r.l / r.n) * 100}%` }}>{r.l || ''}</span>
    </div>
  );
}
