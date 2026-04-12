import { useMemo } from 'react';
import dayjs from 'dayjs';
import InfoTip from './InfoTip';

interface PotdEntry {
  date: string;
  kickoffTime: string;
  homeTeam: string;
  awayTeam: string;
  tournament: string;
  tip: string;
  confidence: number;
  odds: number;
  ev: number;
  score: string | null;
  outcome: 'pending' | 'won' | 'lost';
  status?: string;
  reasoning: string;
  profit: number;
}

interface PotdHistoryProps {
  data: {
    history: PotdEntry[];
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

interface MonthGroup {
  month: string;        // YYYY-MM
  label: string;        // "April 2026"
  entries: PotdEntry[];
  total: number;
  settled: number;
  wins: number;
  losses: number;
  hitRatio: number;
  totalProfit: number;
}

const tipLabel = (t: string) => (t === '1' ? 'H' : t === '2' ? 'A' : 'D');

function groupByMonth(history: PotdEntry[]): MonthGroup[] {
  const map = new Map<string, PotdEntry[]>();
  for (const h of history) {
    const key = dayjs(h.date).format('YYYY-MM');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }
  const groups: MonthGroup[] = [];
  for (const [month, entries] of map.entries()) {
    const settledEntries = entries.filter(e => e.outcome === 'won' || e.outcome === 'lost');
    const wins = settledEntries.filter(e => e.outcome === 'won').length;
    const losses = settledEntries.length - wins;
    const hitRatio = settledEntries.length > 0 ? wins / settledEntries.length : 0;
    const totalProfit = settledEntries.reduce((sum, e) => sum + e.profit, 0);
    groups.push({
      month,
      label: dayjs(month + '-01').format('MMMM YYYY'),
      entries,
      total: entries.length,
      settled: settledEntries.length,
      wins,
      losses,
      hitRatio,
      totalProfit: +totalProfit.toFixed(2),
    });
  }
  groups.sort((a, b) => b.month.localeCompare(a.month));
  return groups;
}

export default function PotdHistory({ data }: PotdHistoryProps) {
  const history = data?.history ?? [];
  const monthGroups = useMemo(() => groupByMonth(history), [history]);

  if (!data || history.length === 0) return null;

  const { summary } = data;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          &#127942; Pick of the Day History
          <InfoTip text="Track record of every day's Pick of the Day selection and its result. Grouped by month — click a month to expand." />
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

      <div className="flex flex-col gap-2">
        {monthGroups.map((g) => (
          <details key={g.month} style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
            <summary
              className="cursor-pointer px-3 py-2 flex items-center justify-between flex-wrap gap-2"
              style={{ background: 'var(--bg-primary)', listStyle: 'none' }}
            >
              <span className="font-semibold text-sm">{g.label}</span>
              <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>{g.total} pick{g.total !== 1 ? 's' : ''}</span>
                {g.settled > 0 && (
                  <>
                    <span>
                      <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{g.wins}W</span>
                      <span> - </span>
                      <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{g.losses}L</span>
                    </span>
                    <span>
                      Hit: <span style={{ color: g.hitRatio >= 0.6 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                        {(g.hitRatio * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span style={{ color: g.totalProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {g.totalProfit >= 0 ? '+' : ''}{g.totalProfit}u
                    </span>
                  </>
                )}
              </span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left py-2 px-2 font-medium">Date</th>
                    <th className="text-center py-2 px-2 font-medium">Time</th>
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
                  {g.entries.map((h, i) => {
                    const isVoid = h.outcome === 'pending' && (h.status === 'cancelled' || h.status === 'postponed');
                    const voidLabel = h.status === 'cancelled' ? 'CAN' : 'PPD';
                    const outcomeColor = h.outcome === 'won' ? 'var(--accent-green)'
                      : h.outcome === 'lost' ? 'var(--accent-red)'
                      : isVoid ? (h.status === 'cancelled' ? 'var(--text-secondary)' : '#f59e0b')
                      : 'var(--text-secondary)';
                    const dateStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const dayStr = new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
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
                        <td className="py-2.5 px-2 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {h.kickoffTime || '-'}
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
                          {isVoid ? voidLabel : (h.score || '-')}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-bold"
                            style={{
                              background: h.outcome === 'won' ? 'rgba(34,197,94,0.15)'
                                : h.outcome === 'lost' ? 'rgba(239,68,68,0.15)'
                                : isVoid ? (h.status === 'cancelled' ? 'rgba(148,163,184,0.15)' : 'rgba(245,158,11,0.15)')
                                : 'rgba(148,163,184,0.15)',
                              color: outcomeColor,
                            }}
                          >
                            {h.outcome === 'won' ? 'WON' : h.outcome === 'lost' ? 'LOST' : isVoid ? voidLabel : 'PENDING'}
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
          </details>
        ))}
      </div>
    </div>
  );
}
