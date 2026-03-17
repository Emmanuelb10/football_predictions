import { useState } from 'react';
import InfoTip from './InfoTip';

interface MatchTableProps {
  matches: any[];
  loading: boolean;
  date: string;
  isFetching?: boolean;
  settledIds?: Set<number>;
}

const TIERS = [
  { label: 'HIGH CONFIDENCE', min: 0.90, accent: '#f59e0b', bg: 'rgba(245,158,11,0.06)' },
  { label: 'STRONG', min: 0.80, accent: '#22c55e', bg: 'rgba(34,197,94,0.06)' },
  { label: 'VALUE', min: 0.70, accent: '#3b82f6', bg: 'rgba(59,130,246,0.06)' },
];

export default function MatchTable({ matches, loading, date, isFetching, settledIds }: MatchTableProps) {
  const [showNonValue, setShowNonValue] = useState(false);

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center gap-3 py-8 justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-transparent" style={{ borderTopColor: 'var(--accent-blue)' }}></div>
          <span style={{ color: 'var(--text-secondary)' }}>Loading predictions for {new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}...</span>
        </div>
      </div>
    );
  }

  const formatTime = (kickoff: string) =>
    new Date(kickoff).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  const getResult = (m: any) => {
    if (m.status === 'finished') return `${m.home_score} - ${m.away_score}`;
    if (m.status === 'live') return 'LIVE';
    return 'vs';
  };

  const getResultColor = (m: any) => {
    if (m.status !== 'finished' || !m.tip) return 'var(--text-secondary)';
    const actual = m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X';
    return m.tip === actual ? 'var(--accent-green)' : 'var(--accent-red)';
  };

  const isWin = (m: any) => {
    if (m.status !== 'finished' || !m.tip) return null;
    const actual = m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X';
    return m.tip === actual;
  };

  const isValueOdds = (val: number) => val >= 1.5 && val <= 2.0;

  const OddsVal = ({ val }: { val: number }) => (
    <span
      style={{
        color: isValueOdds(val) ? '#22c55e' : 'var(--text-secondary)',
        fontWeight: isValueOdds(val) ? 700 : 400,
        background: isValueOdds(val) ? 'rgba(34,197,94,0.12)' : 'transparent',
        padding: isValueOdds(val) ? '1px 4px' : '0',
        borderRadius: 4,
      }}
    >
      {val.toFixed(2)}
    </span>
  );

  const renderOdds = (m: any) => {
    if (!m.odds || m.odds.length === 0) return <span>-</span>;
    const o = m.odds[0];
    return <span className="font-mono text-xs"><OddsVal val={o.home} /> / <OddsVal val={o.draw} /> / <OddsVal val={o.away} /></span>;
  };

  // Split matches into tiers
  const tiered: Array<{ tier: typeof TIERS[0]; matches: any[] }> = TIERS.map((t) => ({
    tier: t,
    matches: matches.filter((m: any) => m.is_value_bet && Number(m.confidence) >= t.min &&
      (t.min === 0.70 || Number(m.confidence) < (TIERS[TIERS.indexOf(t) - 1]?.min || 1))),
  }));
  // Ensure each match only in one tier (highest)
  const assigned = new Set<number>();
  for (const t of tiered) {
    t.matches = t.matches.filter((m: any) => {
      if (assigned.has(m.id)) return false;
      assigned.add(m.id);
      return true;
    });
  }
  const nonValue = matches.filter((m: any) => !assigned.has(m.id));

  const renderRow = (m: any, accentColor?: string) => {
    const settled = settledIds?.has(m.id);
    const won = isWin(m);
    const flashClass = settled ? (won ? 'animate-win-flash' : 'animate-loss-flash') : '';

    return (
      <tr
        key={m.id}
        className={`transition-colors ${flashClass}`}
        style={{
          borderBottom: '1px solid var(--border)',
          borderLeft: accentColor ? `3px solid ${accentColor}` : 'none',
        }}
      >
        <td className="py-2 px-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{formatTime(m.kickoff)}</td>
        <td className="py-2 px-2 text-sm font-medium">{m.home_team}</td>
        <td className="py-2 px-2 text-sm font-medium">{m.away_team}</td>
        <td className="py-2 px-2 text-center">
          {m.confidence ? (
            <span className="font-semibold" style={{ color: Number(m.confidence) >= 0.7 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
              {(Number(m.confidence) * 100).toFixed(0)}%
            </span>
          ) : '-'}
        </td>
        <td className="py-2 px-2 text-center">
          {m.tip ? <span className={`badge ${m.is_value_bet ? 'badge-green' : 'badge-blue'}`}>{m.tip}</span> : '-'}
        </td>
        <td className="py-2 px-2 text-center">{renderOdds(m)}</td>
        <td className="py-2 px-2 text-center">
          {m.expected_value ? (
            <span style={{ color: Number(m.expected_value) > 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontSize: 12, fontWeight: 600 }}>
              {Number(m.expected_value) > 0 ? '+' : ''}{(Number(m.expected_value) * 100).toFixed(1)}%
            </span>
          ) : '-'}
        </td>
        <td className="py-2 px-2 text-center font-bold text-sm" style={{ color: getResultColor(m) }}>
          {getResult(m)}
          {m.status === 'finished' && won !== null && (
            <span style={{ marginLeft: 4, fontSize: 11 }}>{won ? ' &#10003;' : ' &#10007;'}</span>
          )}
        </td>
      </tr>
    );
  };

  const tableHeader = (
    <thead>
      <tr style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        <th className="text-left py-2 px-2 font-medium">Time</th>
        <th className="text-left py-2 px-2 font-medium">Home</th>
        <th className="text-left py-2 px-2 font-medium">Away</th>
        <th className="text-center py-2 px-2 font-medium">Prob<InfoTip text="The AI's estimated probability of the tipped outcome winning" /></th>
        <th className="text-center py-2 px-2 font-medium">Tip<InfoTip text="Predicted outcome: 1 = Home Win, X = Draw, 2 = Away Win" /></th>
        <th className="text-center py-2 px-2 font-medium">Odds (H/D/A)</th>
        <th className="text-center py-2 px-2 font-medium">EV<InfoTip text="Expected Value — positive EV means profitable long-term. EV = (probability x odds) - 1" /></th>
        <th className="text-center py-2 px-2 font-medium">Result</th>
      </tr>
    </thead>
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">
          Predictions for {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <div className="flex items-center gap-3">
          {isFetching && (
            <span className="text-xs animate-pulse" style={{ color: 'var(--accent-blue)' }}>Updating...</span>
          )}
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{matches.length} matches</span>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-lg mb-2">No matches found for this date</p>
        </div>
      ) : (
        <>
          {/* Tiered value bets */}
          {tiered.map(({ tier, matches: tierMatches }) =>
            tierMatches.length > 0 ? (
              <div key={tier.label} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: tier.accent }}></div>
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: tier.accent }}>
                    {tier.label} ({tierMatches.length})
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg" style={{ background: tier.bg }}>
                  <table className="w-full text-sm">
                    {tableHeader}
                    <tbody>{tierMatches.map((m: any) => renderRow(m, tier.accent))}</tbody>
                  </table>
                </div>
              </div>
            ) : null
          )}

          {/* Non-value bets (collapsible) */}
          {nonValue.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowNonValue(!showNonValue)}
                className="text-sm font-medium mb-2 px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                {showNonValue ? 'Hide' : 'Show'} {nonValue.length} other matches
              </button>
              {showNonValue && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    {tableHeader}
                    <tbody>{nonValue.map((m: any) => renderRow(m))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
