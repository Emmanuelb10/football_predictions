import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAccumulatorHistory } from '../hooks/useMatches';
import dayjs from 'dayjs';

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
  result: 'pending' | 'won' | 'lost';
  payout: number;
}

interface DayEntry {
  date: string;
  accumulators: Accumulator[];
}

const STAKE = 1000;

const tipLabel = (t: string) => (t === '1' ? 'Home' : t === '2' ? 'Away' : 'Draw');
const pickResultIcon = (r: string) => r === 'won' ? '\u2713' : r === 'lost' ? '\u2717' : '\u2022';

const resultColors = {
  won: { bg: 'rgba(34,197,94,0.1)', border: 'var(--accent-green)', text: 'var(--accent-green)' },
  lost: { bg: 'rgba(239,68,68,0.1)', border: 'var(--accent-red)', text: 'var(--accent-red)' },
  pending: { bg: 'var(--bg-primary)', border: 'var(--border)', text: 'var(--text-secondary)' },
};

function formatKes(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs >= 1000
    ? abs.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : abs.toFixed(0);
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return '0';
}

function accPL(acc: Accumulator): number {
  if (acc.result === 'won') return Math.round(STAKE * (acc.combinedOdds - 1));
  if (acc.result === 'lost') return -STAKE;
  return 0;
}

interface MonthStats {
  total: number;
  settled: number;
  wins: number;
  losses: number;
  totalStaked: number;
  totalPL: number;
  hitRatio: number;
  roi: number;
}

export default function AccumulatorHistoryPage() {
  const { data, isLoading } = useAccumulatorHistory();
  const history: DayEntry[] = data?.history ?? [];

  const computeStats = (days: DayEntry[]): MonthStats => {
    let total = 0, settled = 0, wins = 0, losses = 0, totalPL = 0;
    for (const day of days) {
      for (const acc of day.accumulators) {
        total++;
        if (acc.result === 'won' || acc.result === 'lost') {
          settled++;
          totalPL += accPL(acc);
          if (acc.result === 'won') wins++;
          else losses++;
        }
      }
    }
    const totalStaked = settled * STAKE;
    return {
      total, settled, wins, losses, totalStaked, totalPL,
      hitRatio: settled > 0 ? wins / settled : 0,
      roi: totalStaked > 0 ? totalPL / totalStaked : 0,
    };
  };

  const stats = useMemo(() => computeStats(history), [history]);

  // Group by month
  const monthGroups = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    for (const day of history) {
      const key = dayjs(day.date).format('YYYY-MM');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(day);
    }
    const groups = Array.from(map.entries()).map(([month, days]) => {
      const ms = computeStats(days);
      return { month, label: dayjs(month + '-01').format('MMMM YYYY'), days, stats: ms };
    });
    groups.sort((a, b) => b.month.localeCompare(a.month));
    return groups;
  }, [history]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <header className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">&#127922;</span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Accumulator History
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Past accumulator suggestions and results
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            &larr; Back to Predictions
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {isLoading && (
          <div className="card text-center py-8" style={{ color: 'var(--text-secondary)' }}>Loading accumulator history...</div>
        )}

        {!isLoading && history.length === 0 && (
          <div className="card text-center py-8" style={{ color: 'var(--text-secondary)' }}>No accumulator history found.</div>
        )}

        {!isLoading && history.length > 0 && (
          <>
            {/* Overall stats */}
            <div className="card">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Overall Performance</h2>
                <div className="flex items-center gap-4 text-sm flex-wrap">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {stats.total} accumulators ({stats.settled} settled)
                  </span>
                  {stats.settled > 0 && (
                    <>
                      <span>
                        <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{stats.wins}W</span>
                        <span style={{ color: 'var(--text-secondary)' }}> - </span>
                        <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{stats.losses}L</span>
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Hit: <span style={{ color: stats.hitRatio >= 0.3 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                          {(stats.hitRatio * 100).toFixed(0)}%
                        </span>
                      </span>
                      <span style={{ color: stats.totalPL >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                        P&L: {formatKes(stats.totalPL)}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Staked: <span style={{ fontWeight: 700 }}>{stats.totalStaked.toLocaleString('en-KE')}</span>
                      </span>
                      <span style={{ color: stats.roi >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                        ROI: {stats.roi >= 0 ? '+' : ''}{(stats.roi * 100).toFixed(1)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Month groups */}
            <div className="flex flex-col gap-2">
              {monthGroups.map((mg) => (
                <details key={mg.month} open={mg.month === monthGroups[0]?.month} style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
                  <summary
                    className="cursor-pointer px-3 py-2 flex items-center justify-between flex-wrap gap-2"
                    style={{ background: 'var(--bg-primary)', listStyle: 'none' }}
                  >
                    <span className="font-semibold text-sm">{mg.label}</span>
                    <span className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <span>{mg.stats.total} acca{mg.stats.total !== 1 ? 's' : ''}</span>
                      {mg.stats.settled > 0 && (
                        <>
                          <span>
                            <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{mg.stats.wins}W</span>
                            <span> - </span>
                            <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>{mg.stats.losses}L</span>
                          </span>
                          <span style={{ color: mg.stats.totalPL >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                            {formatKes(mg.stats.totalPL)}
                          </span>
                          <span>
                            Staked: <span style={{ fontWeight: 700 }}>{mg.stats.totalStaked.toLocaleString('en-KE')}</span>
                          </span>
                          <span style={{ color: mg.stats.roi >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                            ROI: {mg.stats.roi >= 0 ? '+' : ''}{(mg.stats.roi * 100).toFixed(1)}%
                          </span>
                        </>
                      )}
                    </span>
                  </summary>
                  <div className="p-3 space-y-4">
                    {mg.days.map((day) => {
                      const dateObj = new Date(day.date + 'T12:00:00');
                      const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                      return (
                        <div key={day.date}>
                          <div className="flex items-center gap-2 mb-2">
                            <Link
                              to={`/${day.date}`}
                              className="text-sm font-semibold hover:underline"
                              style={{ color: 'var(--accent-gold)' }}
                            >
                              {dateLabel}
                            </Link>
                            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {day.accumulators.length} accumulator{day.accumulators.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {day.accumulators.map((acc, ai) => {
                              const evColor = acc.combinedEV > 0.3 ? 'var(--accent-green)' : acc.combinedEV > 0 ? 'var(--accent-yellow)' : 'var(--accent-red)';
                              const rc = resultColors[acc.result];
                              return (
                                <div key={ai} className="rounded-lg p-3" style={{ background: rc.bg, border: `1px solid ${rc.border}` }}>
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
                                          {acc.result === 'won' ? `WON ${formatKes(accPL(acc))}` : `LOST ${formatKes(accPL(acc))}`}
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
                                              <span className="text-xs font-bold" style={{ color: legColor }}>{p.score}</span>
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
                                  <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                    <span>Stake: {STAKE.toLocaleString('en-KE')}</span>
                                    {acc.result !== 'pending' && (
                                      <span style={{ color: accPL(acc) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                                        P&L: {formatKes(accPL(acc))}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
