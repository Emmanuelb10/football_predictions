import InfoTip from './InfoTip';

interface AccumulatorCardProps {
  data: {
    accumulators: Array<{
      picks: Array<{ homeTeam: string; awayTeam: string; tip: string; confidence: number; odds: number; tournament: string }>;
      size: number;
      combinedOdds: number;
      combinedProb: number;
      combinedEV: number;
      diversityScore: number;
    }>;
  } | undefined;
}

const tipLabel = (t: string) => (t === '1' ? 'Home' : t === '2' ? 'Away' : 'Draw');

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
          return (
            <div
              key={i}
              className="rounded-lg p-3"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  {acc.size}-Fold
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
                  {acc.combinedOdds.toFixed(2)}x
                </span>
              </div>

              <div className="space-y-1.5 mb-3">
                {acc.picks.map((p, j) => (
                  <div key={j} className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-primary)' }}>
                      {p.homeTeam} vs {p.awayTeam}
                    </span>
                    <span className="badge badge-green ml-2" style={{ fontSize: 10 }}>
                      {tipLabel(p.tip)} @{p.odds.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

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
