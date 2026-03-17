import InfoTip from './InfoTip';

interface Pick {
  homeTeam: string;
  awayTeam: string;
  tip: string;
  confidence: number;
  odds: number;
  tournament: string;
  result: 'pending' | 'won' | 'lost';
  score: string | null;
}

interface Accumulator {
  picks: Pick[];
  size: number;
  combinedOdds: number;
  combinedProb: number;
  combinedEV: number;
  diversityScore: number;
  result: 'pending' | 'won' | 'lost';
  payout: number;
}

interface AccumulatorCardProps {
  data: { accumulators: Accumulator[] } | undefined;
}

const tipLabel = (t: string) => (t === '1' ? 'Home' : t === '2' ? 'Away' : 'Draw');

const resultColors = {
  won: { bg: 'rgba(34,197,94,0.1)', border: 'var(--accent-green)', text: 'var(--accent-green)' },
  lost: { bg: 'rgba(239,68,68,0.1)', border: 'var(--accent-red)', text: 'var(--accent-red)' },
  pending: { bg: 'var(--bg-primary)', border: 'var(--border)', text: 'var(--text-secondary)' },
};

const pickResultIcon = (r: string) =>
  r === 'won' ? '\u2713' : r === 'lost' ? '\u2717' : '\u2022';

export default function AccumulatorCard({ data }: AccumulatorCardProps) {
  if (!data || data.accumulators.length === 0) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
        &#127922; Accumulator Suggestions<InfoTip text="A multi-bet combining several picks. All legs must win. Combined odds = odds multiplied together" />
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {data.accumulators.slice(0, 3).map((acc, i) => {
          const evColor = acc.combinedEV > 0.3 ? 'var(--accent-green)' : acc.combinedEV > 0 ? 'var(--accent-yellow)' : 'var(--accent-red)';
          const rc = resultColors[acc.result];

          return (
            <div
              key={i}
              className="rounded-lg p-3"
              style={{ background: rc.bg, border: `1px solid ${rc.border}` }}
            >
              {/* Header */}
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {acc.size}-Fold
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
                    {acc.combinedOdds.toFixed(2)}x
                  </span>
                  {acc.result !== 'pending' && (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{ background: rc.bg, color: rc.text, border: `1px solid ${rc.border}` }}
                    >
                      {acc.result === 'won' ? `WON +${(acc.payout - 1).toFixed(2)}u` : 'LOST -1u'}
                    </span>
                  )}
                </div>
              </div>

              {/* Legs */}
              <div className="space-y-1.5 mb-3">
                {acc.picks.map((p, j) => {
                  const legColor = p.result === 'won' ? 'var(--accent-green)' : p.result === 'lost' ? 'var(--accent-red)' : 'var(--text-primary)';
                  return (
                    <div key={j} className="flex justify-between items-center text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span style={{ color: p.result === 'won' ? 'var(--accent-green)' : p.result === 'lost' ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>
                          {pickResultIcon(p.result)}
                        </span>
                        <span className="truncate" style={{ color: legColor }}>
                          {p.homeTeam} vs {p.awayTeam}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.score && (
                          <span className="text-xs font-bold" style={{ color: legColor }}>
                            {p.score}
                          </span>
                        )}
                        <span className={`badge ${p.result === 'won' ? 'badge-green' : p.result === 'lost' ? 'badge-red' : 'badge-blue'}`} style={{ fontSize: 10 }}>
                          {tipLabel(p.tip)} @{p.odds.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex justify-between text-xs" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Prob: {(acc.combinedProb * 100).toFixed(1)}%
                </span>
                <span style={{ color: evColor, fontWeight: 700 }}>
                  EV: {acc.combinedEV > 0 ? '+' : ''}{(acc.combinedEV * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
