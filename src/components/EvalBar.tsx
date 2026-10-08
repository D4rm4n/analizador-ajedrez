import type { Score } from '../types';
import { formatScoreShort, scoreToWhiteWin } from '../analysis';

export default function EvalBar({ score, orientation }: { score?: Score; orientation: 'white' | 'black' }) {
  let white = score ? scoreToWhiteWin(score) : 50;
  if (score && score.kind === 'cp') white = Math.max(4, Math.min(96, white));
  const whiteAhead = score ? (score.kind === 'mate' ? score.v > 0 || (score.v === 0 && score.mated === 'b') : score.v >= 0) : true;
  const label = formatScoreShort(score);
  const flipped = orientation === 'black';
  return (
    <div className={'eval-bar' + (flipped ? ' flipped' : '')} data-testid="eval-bar" data-white={white.toFixed(1)}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <div className={'eval-label ' + (whiteAhead !== flipped ? 'bottom' : 'top') + (whiteAhead ? ' on-white' : ' on-black')}>
        {label}
      </div>
    </div>
  );
}
