import { type EngineSettings, type SoundSettings, estimateSecondsPerPosition, fmtDuration } from '../settings';
import { play } from '../sound';

const TIMES = [250, 500, 1000, 2000, 3000, 5000, 10000];

export function EngineControls({
  value,
  onChange,
  positions,
  onReanalyze,
  busy,
  compact,
}: {
  value: EngineSettings;
  onChange: (v: EngineSettings) => void;
  positions?: number;
  onReanalyze?: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const per = estimateSecondsPerPosition(value);
  const total = positions ? per * positions : null;
  const modeSeg = (
    <div className="seg small-seg">
      <button className={value.mode === 'depth' ? 'on' : ''} onClick={() => onChange({ ...value, mode: 'depth' })} data-testid="mode-depth">
        {compact ? 'Prof.' : 'Profundidad'}
      </button>
      <button className={value.mode === 'time' ? 'on' : ''} onClick={() => onChange({ ...value, mode: 'time' })} data-testid="mode-time">
        {compact ? 'Tiempo' : 'Tiempo por jugada'}
      </button>
    </div>
  );
  const control =
    value.mode === 'depth' ? (
      <div className="ec-slider">
        <input
          type="range"
          min={10}
          max={22}
          step={1}
          value={value.depth}
          onChange={(e) => onChange({ ...value, depth: parseInt(e.target.value, 10) })}
          aria-label="Profundidad"
          data-testid="depth-slider"
        />
        <span className="ec-value" data-testid="depth-value">{value.depth}</span>
      </div>
    ) : compact ? (
      <select className="ec-select" value={value.ms} onChange={(e) => onChange({ ...value, ms: parseInt(e.target.value, 10) })} data-testid="time-select">
        {TIMES.map((t) => (
          <option key={t} value={t}>{t / 1000} s / jugada</option>
        ))}
      </select>
    ) : (
      <div className="chips">
        {TIMES.map((t) => (
          <button key={t} className={'chip' + (value.ms === t ? ' on' : '')} onClick={() => onChange({ ...value, ms: t })} data-testid={'time-' + t}>
            {t / 1000} s
          </button>
        ))}
      </div>
    );
  const hint = (
    <div className="ec-hint">
      {compact ? 'Más profundidad = más preciso pero más lento.' : 'Más profundidad o más tiempo = análisis más preciso, pero más lento.'}{' '}
      {total !== null ? (
        <>≈ <strong>{fmtDuration(total)}</strong> {compact ? 'por partida' : `para esta partida (${positions} posiciones)`}.</>
      ) : (
        <>≈ {per < 1 ? per.toFixed(1) : Math.round(per)} s por posición.</>
      )}
    </div>
  );
  if (compact) {
    return (
      <div className="engine-controls compact" data-testid="engine-controls">
        <div className="ec-row">
          <span className="ec-label">⚙ Motor</span>
          {modeSeg}
          {control}
          {onReanalyze && (
            <button className="btn primary reanalyze" onClick={onReanalyze} disabled={busy} data-testid="reanalyze" title="Volver a analizar la partida con estos ajustes">
              ↻ Re-analizar
            </button>
          )}
        </div>
        {hint}
      </div>
    );
  }
  return (
    <div className="engine-controls" data-testid="engine-controls">
      <div className="ec-row">
        <span className="ec-label">⚙ Motor</span>
        {modeSeg}
      </div>
      <div className="ec-row">{control}</div>
      {hint}
    </div>
  );
}

export function SoundControls({ value, onChange }: { value: SoundSettings; onChange: (v: SoundSettings) => void }) {
  const off = value.muted || value.volume === 0;
  const icon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {off ? (
        <>
          <line x1="16" y1="9" x2="22" y2="15" />
          <line x1="22" y1="9" x2="16" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          {value.volume >= 0.5 && <path d="M18.5 5.5a9 9 0 0 1 0 13" />}
        </>
      )}
    </svg>
  );
  return (
    <div className="sound-controls">
      <button
        className="icon-btn"
        onClick={() => {
          const next = { ...value, muted: !value.muted };
          onChange(next);
          if (!next.muted) setTimeout(() => play('move'), 30);
        }}
        title={value.muted ? 'Activar sonido' : 'Silenciar'}
        aria-label={value.muted ? 'Activar sonido' : 'Silenciar'}
        data-testid="sound-toggle"
        data-muted={value.muted ? '1' : '0'}
      >
        {icon}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value.volume}
        disabled={value.muted}
        onChange={(e) => onChange({ ...value, volume: parseFloat(e.target.value) })}
        onMouseUp={() => play('move')}
        aria-label="Volumen"
        title={`Volumen ${Math.round(value.volume * 100)}%`}
        data-testid="volume"
      />
    </div>
  );
}
