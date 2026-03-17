import InfoTip from './InfoTip';

interface PotdHistoryProps {
  data: {
    history: Array<{
      date: string;
      homeTeam: string;
      awayTeam: string;
      tournament: string;
      tip: string;
      confidence: number;
      odds: number;
      ev: number;
      score: string | null;
      outcome: 'pending' | 'won' | 'lost' | 'none';
      reasoning: string;
      profit: number;
    }>;
    summary: {
      total: number;
      settled: number;
      wins: number;
      losses: number;
      hitRatio: number;
      totalProfit: number;
    };
  } | undefined;
}

const tipLabel = (t: string) => (t === '1' ? 'H' : t === '2' ? 'A' : 'D');

export default function PotdHistory({ data }: PotdHistoryProps) {
  if (!data || data.history.length === 0) return null;

  const { history, summary } = data;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          &#127942; Pick of the Day History
          <InfoTip text="Track record of every day's Pick of the Day selection and its result" />
        </h2>
        {summary.settled > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span>
              <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{summary.wins}W</span>
              <span style={{ color: 'var(--text-secondary)' }}> - </span>
              <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{summary.losses}L</span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Hit: <span style={{ color: summary.hitRatio >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                {(summary.hitRatio * 100).toFixed(0)}%
              </span>
            </span>
            <span style={{ color: summary.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
              {summary.totalProfit >= 0 ? '+' : ''}{summary.totalProfit}u
            </span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ color: 'var(--text-secondary)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
              <th className="text-left py-2 px-2 font-medium">Date</th>
              <th className="text-left py-2 px-2 font-medium">Match</th>
              <th className="text-left py-2 px-2 font-medium">League</th>
              <th className="text-center py-2 px-2 font-medium">Tip</th>
              <th className="text-center py-2 px-2 font-medium">Prob</th>
              <th className="text-center py-2 px-2 font-medium">Odds</th>
              <th className="text-center py-2 px-2 font-medium">EV</th>
              <th className="text-center py-2 px-2 font-medium">Score</th>
              <th className="text-center py-2 px-2 font-medium">Result</th>
              <th className="text-center py-2 px-2 font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => {
              const isNone = h.outcome === 'none';
              const outcomeColor = h.outcome === 'won' ? 'var(--accent-green)' : h.outcome === 'lost' ? 'var(--accent-red)' : 'var(--text-secondary)';
              const dateStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const dayStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });

              if (isNone) {
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-2 px-2">
                      <div className="text-xs font-medium">{dateStr}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dayStr}</div>
                    </td>
                    <td colSpan={9} className="py-2 px-2 text-xs text-center" style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      No qualifying pick
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={i}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: h.outcome === 'won' ? 'rgba(34,197,94,0.04)' : h.outcome === 'lost' ? 'rgba(239,68,68,0.04)' : 'transparent',
                  }}
                >
                  <td className="py-2.5 px-2">
                    <div className="text-xs font-medium">{dateStr}</div>
                    <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dayStr}</div>
                  </td>
                  <td className="py-2.5 px-2 font-medium text-sm">
                    {h.homeTeam} vs {h.awayTeam}
                  </td>
                  <td className="py-2.5 px-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {h.tournament}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span className="badge badge-green">{tipLabel(h.tip)}</span>
                  </td>
                  <td className="py-2.5 px-2 text-center font-semibold" style={{ color: 'var(--accent-green)' }}>
                    {(h.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono text-xs"
                    style={{ color: h.odds >= 1.5 && h.odds <= 2.0 ? 'var(--accent-green)' : 'var(--text-secondary)', fontWeight: h.odds >= 1.5 && h.odds <= 2.0 ? 700 : 400 }}>
                    {h.odds.toFixed(2)}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span style={{ color: h.ev > 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 12, fontWeight: 600 }}>
                      {h.ev > 0 ? '+' : ''}{(h.ev * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center font-bold" style={{ color: outcomeColor }}>
                    {h.score || '-'}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{
                        background: h.outcome === 'won' ? 'rgba(34,197,94,0.15)' : h.outcome === 'lost' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)',
                        color: outcomeColor,
                      }}
                    >
                      {h.outcome === 'won' ? 'WON' : h.outcome === 'lost' ? 'LOST' : 'PENDING'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center font-bold text-sm" style={{ color: outcomeColor }}>
                    {h.outcome === 'pending' ? '-' : `${h.profit > 0 ? '+' : ''}${h.profit.toFixed(2)}u`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
