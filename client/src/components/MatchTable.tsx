interface MatchTableProps {
  matches: any[];
  loading: boolean;
  date: string;
}

export default function MatchTable({ matches, loading, date }: MatchTableProps) {
  if (loading) {
    return (
      <div className="card">
        <h2 className="text-lg font-bold mb-4">Today's Predictions</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse h-12 rounded" style={{ background: 'var(--bg-primary)' }}></div>
          ))}
        </div>
      </div>
    );
  }

  // Group matches by tournament
  const grouped: Record<string, any[]> = {};
  for (const m of matches) {
    const key = m.tournament || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  const formatTime = (kickoff: string) =>
    new Date(kickoff).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  const getResultDisplay = (m: any) => {
    if (m.status === 'finished') return `${m.home_score} - ${m.away_score}`;
    if (m.status === 'live') return 'LIVE';
    return 'vs';
  };

  const getResultColor = (m: any) => {
    if (m.status !== 'finished' || !m.tip) return 'var(--text-secondary)';
    const actual = m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X';
    return m.tip === actual ? 'var(--accent-green)' : 'var(--accent-red)';
  };

  const formatOdds = (m: any) => {
    if (!m.odds || m.odds.length === 0) return '-';
    const o = m.odds[0];
    return `${o.home.toFixed(2)} / ${o.draw.toFixed(2)} / ${o.away.toFixed(2)}`;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">
          Predictions for {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {matches.length} matches
        </span>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-8" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-lg mb-2">No matches found for this date</p>
          <p className="text-sm">Try triggering a fixture ingestion or selecting a different date.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([tournament, tournamentMatches]) => (
          <div key={tournament} className="mb-6">
            <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--accent-blue)' }}>
                {tournament}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                ({tournamentMatches[0]?.tournament_country})
              </span>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-secondary)' }}>
                    <th className="text-left py-2 px-2 font-medium">Time</th>
                    <th className="text-left py-2 px-2 font-medium">Home</th>
                    <th className="text-left py-2 px-2 font-medium">Away</th>
                    <th className="text-center py-2 px-2 font-medium">Win Prob</th>
                    <th className="text-center py-2 px-2 font-medium">Tip</th>
                    <th className="text-center py-2 px-2 font-medium">Odds (H/D/A)</th>
                    <th className="text-center py-2 px-2 font-medium">EV</th>
                    <th className="text-center py-2 px-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {tournamentMatches.map((m: any) => (
                    <tr
                      key={m.id}
                      className="transition-colors"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: m.is_pick_of_day
                          ? 'rgba(245, 158, 11, 0.08)'
                          : m.is_value_bet
                          ? 'rgba(34, 197, 94, 0.05)'
                          : 'transparent',
                      }}
                    >
                      <td className="py-2.5 px-2" style={{ color: 'var(--text-secondary)' }}>
                        {formatTime(m.kickoff)}
                      </td>
                      <td className="py-2.5 px-2 font-medium">{m.home_team}</td>
                      <td className="py-2.5 px-2 font-medium">{m.away_team}</td>
                      <td className="py-2.5 px-2 text-center">
                        {m.confidence ? (
                          <span
                            className="font-semibold"
                            style={{ color: Number(m.confidence) >= 0.7 ? 'var(--accent-green)' : 'var(--text-primary)' }}
                          >
                            {(Number(m.confidence) * 100).toFixed(1)}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {m.tip ? (
                          <span className={`badge ${m.is_value_bet ? 'badge-green' : 'badge-blue'}`}>
                            {m.tip}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {formatOdds(m)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {m.expected_value ? (
                          <span style={{ color: Number(m.expected_value) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {Number(m.expected_value) > 0 ? '+' : ''}{(Number(m.expected_value) * 100).toFixed(1)}%
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-2 text-center font-bold" style={{ color: getResultColor(m) }}>
                        {getResultDisplay(m)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {tournamentMatches.map((m: any) => (
                <div
                  key={m.id}
                  className="rounded-lg p-3"
                  style={{
                    background: m.is_pick_of_day
                      ? 'rgba(245, 158, 11, 0.08)'
                      : 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {formatTime(m.kickoff)}
                    </span>
                    {m.tip && (
                      <span className={`badge ${m.is_value_bet ? 'badge-green' : 'badge-blue'}`}>
                        {m.tip}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium text-sm">{m.home_team}</p>
                      <p className="font-medium text-sm">{m.away_team}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold" style={{ color: getResultColor(m) }}>
                        {getResultDisplay(m)}
                      </p>
                      {m.confidence && (
                        <p className="text-xs" style={{ color: 'var(--accent-green)' }}>
                          {(Number(m.confidence) * 100).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
