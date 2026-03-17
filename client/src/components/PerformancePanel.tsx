import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import InfoTip from './InfoTip';

interface PerformancePanelProps {
  data: {
    summary: {
      hitRatio: number;
      roi: number;
      brierScore: number;
      logLoss: number;
      totalPicks: number;
      wins: number;
      losses: number;
      byLeague?: Record<string, { wins: number; total: number; hitRatio: number }>;
    };
    daily: Array<{
      date: string;
      hitRatio: number;
      totalPicks: number;
      wins: number;
    }>;
    oddsRange: Array<{
      oddsRange: string;
      totalPicks: number;
      hitRatio: number;
      avgOdds: number;
      roi: number;
    }>;
  };
}

export default function PerformancePanel({ data }: PerformancePanelProps) {
  const { summary, daily, oddsRange } = data;

  if (summary.totalPicks === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-bold mb-2">Performance<InfoTip text="AI prediction accuracy over the last 30 days across all value bets" /></h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          No settled predictions yet. Stats will appear once matches are completed.
        </p>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Hit Ratio',
      tip: 'Percentage of correct predictions out of total settled picks',
      value: `${(summary.hitRatio * 100).toFixed(1)}%`,
      color: summary.hitRatio >= 0.6 ? 'var(--accent-green)' : summary.hitRatio >= 0.5 ? 'var(--accent-yellow)' : 'var(--accent-red)',
      sub: `${summary.wins}W - ${summary.losses}L`,
    },
    {
      label: 'ROI',
      tip: 'Return on Investment — total profit divided by total staked, as a percentage',
      value: `${summary.roi > 0 ? '+' : ''}${summary.roi}%`,
      color: summary.roi > 0 ? 'var(--accent-green)' : 'var(--accent-red)',
      sub: `${summary.totalPicks} picks`,
    },
    {
      label: 'Brier Score',
      tip: 'Measures prediction accuracy (0 = perfect, lower is better)',
      value: summary.brierScore.toFixed(4),
      color: summary.brierScore < 0.25 ? 'var(--accent-green)' : 'var(--accent-yellow)',
      sub: 'Lower is better',
    },
    {
      label: 'Log Loss',
      tip: 'Penalizes confident wrong predictions more heavily (lower is better)',
      value: summary.logLoss.toFixed(4),
      color: summary.logLoss < 0.5 ? 'var(--accent-green)' : 'var(--accent-yellow)',
      sub: 'Lower is better',
    },
  ];

  const chartData = [...daily].reverse().map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    hitRatio: +(d.hitRatio * 100).toFixed(1),
  }));

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="card text-center">
            <p className="text-xs mb-1 uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {s.label}{s.tip && <InfoTip text={s.tip} />}
            </p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>
              {s.value}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {s.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Chart + Odds Range Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hit Ratio Chart */}
        {chartData.length > 1 && (
          <div className="card">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
              Daily Hit Ratio (%)
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Line
                  type="monotone"
                  dataKey="hitRatio"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ fill: '#22c55e', r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Odds Range Performance */}
        {oddsRange.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
              Performance by Odds Range
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)' }}>
                  <th className="text-left py-1 font-medium">Range</th>
                  <th className="text-center py-1 font-medium">Picks</th>
                  <th className="text-center py-1 font-medium">Hit %</th>
                  <th className="text-center py-1 font-medium">ROI</th>
                </tr>
              </thead>
              <tbody>
                {oddsRange.map((r) => (
                  <tr key={r.oddsRange} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-2">{r.oddsRange}</td>
                    <td className="py-2 text-center">{r.totalPicks}</td>
                    <td
                      className="py-2 text-center font-semibold"
                      style={{ color: r.hitRatio >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)' }}
                    >
                      {(r.hitRatio * 100).toFixed(1)}%
                    </td>
                    <td
                      className="py-2 text-center font-semibold"
                      style={{ color: r.roi > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
                    >
                      {r.roi > 0 ? '+' : ''}{r.roi}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* League Performance */}
      {summary.byLeague && Object.keys(summary.byLeague).length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            League Performance
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(summary.byLeague)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([league, stats]) => {
                const hr = stats.hitRatio;
                const color = hr >= 0.6 ? 'var(--accent-green)' : hr >= 0.45 ? 'var(--accent-yellow)' : 'var(--accent-red)';
                return (
                  <div key={league} className="p-2 rounded-lg" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{league}</p>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{stats.total} picks</span>
                      <span className="text-sm font-bold" style={{ color }}>{(hr * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
