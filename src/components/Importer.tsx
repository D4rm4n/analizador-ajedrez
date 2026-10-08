import { useState } from 'react';

export interface ImportedGame {
  id: string;
  site: 'chesscom' | 'lichess';
  pgn: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  userColor: 'w' | 'b';
  opponent: string;
  opponentElo?: number;
  result: 'win' | 'loss' | 'draw' | 'other';
  date: Date;
  timeControl: string;
  speed?: string;
  url?: string;
}

const DRAW_CODES = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];
const SPEED_ES: Record<string, string> = {
  bullet: 'Bala', blitz: 'Blitz', rapid: 'Rápida', daily: 'Diaria', classical: 'Clásica', correspondence: 'Correspondencia', ultraBullet: 'UltraBala',
};

function fmtTc(base: number, inc: number) {
  const b = base >= 60 ? `${base / 60}` : `${base}s`;
  return inc ? `${b}+${inc}` : `${b} min`;
}

export async function fetchChessCom(user: string, max = 20): Promise<ImportedGame[]> {
  const u = user.trim().toLowerCase();
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`);
  if (r.status === 404) throw new Error(`No existe el usuario "${user}" en chess.com.`);
  if (!r.ok) throw new Error(`chess.com respondió con error ${r.status}.`);
  const { archives } = (await r.json()) as { archives: string[] };
  if (!archives?.length) return [];
  const games: any[] = [];
  for (let i = archives.length - 1; i >= 0 && games.length < max && i >= archives.length - 3; i--) {
    const a = await fetch(archives[i]);
    if (!a.ok) break;
    const data = await a.json();
    games.push(...(data.games ?? []).filter((g: any) => g.rules === 'chess' && g.pgn).reverse());
  }
  return games.slice(0, max).map((g: any) => {
    const userColor: 'w' | 'b' = g.white.username.toLowerCase() === u ? 'w' : 'b';
    const me = userColor === 'w' ? g.white : g.black;
    const opp = userColor === 'w' ? g.black : g.white;
    const result = me.result === 'win' ? 'win' : DRAW_CODES.includes(me.result) ? 'draw' : 'loss';
    let tc = g.time_control as string;
    if (tc.includes('/')) tc = `${Math.round(parseInt(tc.split('/')[1], 10) / 86400)} d/jug.`;
    else {
      const [b, inc] = tc.split('+').map((x: string) => parseInt(x, 10));
      tc = fmtTc(b, inc || 0);
    }
    return {
      id: g.uuid ?? g.url,
      site: 'chesscom',
      pgn: g.pgn,
      white: g.white.username,
      black: g.black.username,
      whiteElo: g.white.rating,
      blackElo: g.black.rating,
      userColor,
      opponent: opp.username,
      opponentElo: opp.rating,
      result,
      date: new Date(g.end_time * 1000),
      timeControl: tc,
      speed: SPEED_ES[g.time_class] ?? g.time_class,
      url: g.url,
    } as ImportedGame;
  });
}

export async function fetchLichess(user: string, max = 20): Promise<ImportedGame[]> {
  const u = user.trim();
  const r = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=${max}&pgnInJson=true&opening=true&clocks=false&evals=false&finished=true`,
    { headers: { Accept: 'application/x-ndjson' } },
  );
  if (r.status === 404) {
    const exists = await fetch(`https://lichess.org/api/user/${encodeURIComponent(u)}`).then((x) => x.ok).catch(() => false);
    throw new Error(
      exists
        ? 'Lichess rechazó la petición de partidas (404). Puede ocurrir con navegadores automatizados o bloqueadores; inténtalo de nuevo o pega el PGN manualmente.'
        : `No existe el usuario "${user}" en Lichess.`,
    );
  }
  if (r.status === 429) throw new Error('Lichess limitó las peticiones (429). Espera un minuto e inténtalo de nuevo.');
  if (!r.ok) throw new Error(`Lichess respondió con error ${r.status}.`);
  const text = await r.text();
  const games = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return games
    .filter((g: any) => g.variant === 'standard' || g.variant === 'fromPosition')
    .map((g: any) => {
      const wName = g.players.white.user?.name ?? (g.players.white.aiLevel ? `IA nivel ${g.players.white.aiLevel}` : 'Anónimo');
      const bName = g.players.black.user?.name ?? (g.players.black.aiLevel ? `IA nivel ${g.players.black.aiLevel}` : 'Anónimo');
      const userColor: 'w' | 'b' = wName.toLowerCase() === u.toLowerCase() ? 'w' : 'b';
      const result: ImportedGame['result'] = g.winner
        ? (g.winner === 'white') === (userColor === 'w') ? 'win' : 'loss'
        : ['draw', 'stalemate'].includes(g.status) ? 'draw' : 'other';
      const tc = g.clock ? fmtTc(g.clock.initial, g.clock.increment) : g.daysPerTurn ? `${g.daysPerTurn} d/jug.` : '';
      return {
        id: g.id,
        site: 'lichess',
        pgn: g.pgn,
        white: wName,
        black: bName,
        whiteElo: g.players.white.rating,
        blackElo: g.players.black.rating,
        userColor,
        opponent: userColor === 'w' ? bName : wName,
        opponentElo: userColor === 'w' ? g.players.black.rating : g.players.white.rating,
        result,
        date: new Date(g.lastMoveAt ?? g.createdAt),
        timeControl: tc,
        speed: SPEED_ES[g.speed] ?? g.speed,
        url: `https://lichess.org/${g.id}`,
      } as ImportedGame;
    });
}

const RESULT_ES = { win: 'Victoria', loss: 'Derrota', draw: 'Tablas', other: '—' };

export default function Importer({ onPick }: { onPick: (g: ImportedGame) => void }) {
  const [site, setSite] = useState<'chesscom' | 'lichess'>('chesscom');
  const [users, setUsers] = useState({ chesscom: 'Chesster9212', lichess: 'LorDarman' });
  const [games, setGames] = useState<ImportedGame[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async () => {
    setLoading(true);
    setError('');
    setGames(null);
    try {
      const list = site === 'chesscom' ? await fetchChessCom(users.chesscom) : await fetchLichess(users.lichess);
      setGames(list);
      if (!list.length) setError('No se encontraron partidas recientes.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="importer">
      <div className="seg">
        <button className={site === 'chesscom' ? 'on' : ''} onClick={() => { setSite('chesscom'); setGames(null); setError(''); }} data-testid="site-chesscom">
          Chess.com
        </button>
        <button className={site === 'lichess' ? 'on' : ''} onClick={() => { setSite('lichess'); setGames(null); setError(''); }} data-testid="site-lichess">
          Lichess
        </button>
      </div>
      <form className="import-row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input
          value={users[site]}
          onChange={(e) => setUsers({ ...users, [site]: e.target.value })}
          placeholder="Nombre de usuario"
          aria-label="Nombre de usuario"
          data-testid="import-user"
        />
        <button type="submit" className="btn" disabled={loading || !users[site].trim()} data-testid="import-search">
          {loading ? 'Buscando…' : 'Buscar partidas'}
        </button>
      </form>
      {error && <div className="error">{error}</div>}
      {games && games.length > 0 && (
        <ul className="game-list" data-testid="game-list">
          {games.map((g) => (
            <li key={g.id}>
              <button onClick={() => onPick(g)} className="game-item" data-testid="game-item">
                <span className={'res res-' + g.result}>{RESULT_ES[g.result]}</span>
                <span className="gi-main">
                  <span className="gi-opp">
                    <span className={'dot ' + (g.userColor === 'w' ? 'dot-w' : 'dot-b')} title={g.userColor === 'w' ? 'Jugaste con blancas' : 'Jugaste con negras'} />
                    vs {g.opponent} {g.opponentElo ? <em>({g.opponentElo})</em> : null}
                  </span>
                  <span className="gi-meta">
                    {g.date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })} · {g.speed} {g.timeControl}
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
}
