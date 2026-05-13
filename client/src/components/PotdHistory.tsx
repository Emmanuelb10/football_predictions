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

interface EntryWithStake extends PotdEntry {
  stake: number;
  plKes: number;     // profit/loss for this bet in KES
  balanceKes: number; // running balance after this bet
}

interface MonthGroup {
  month: string;
  label: string;
  entries: EntryWithStake[];
  total: number;
  settled: number;
  wins: number;
  losses: number;
  hitRatio: number;
  totalPLKes: number;
  totalStaked: number;
  roi: number;
}

const BASE_STAKE = 1000;
const LOSS_MULTIPLIER = 3;

const tipLabel = (t: string) => (t === '1' ? 'H' : t === '2' ? 'A' : 'D');

function formatAmount(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs >= 1000
    ? abs.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : abs.toFixed(0);
  if (amount > 0) return `+${formatted}`;
  if (amount < 0) return `-${formatted}`;
  return '0';
}

function groupByMonth(history: PotdEntry[]): MonthGroup[] {
  const map = new Map<string, PotdEntry[]>();
  for (const h of history) {
    const key = dayjs(h.date).format('YYYY-MM');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }

  const groups: MonthGroup[] = [];
  for (const [month, rawEntries] of map.entries()) {
    // Sort chronologically (oldest first) for Martingale stake tracking
    const sorted = [...rawEntries].sort((a, b) => a.date.localeCompare(b.date));

    let stake = BASE_STAKE;
    let runningPL = 0;
    const entries: EntryWithStake[] = sorted.map((e) => {
      const isVoid = e.outcome === 'pending' && (e.status === 'cancelled' || e.status === 'postponed');

      if (e.outcome === 'won') {
        const pl = Math.round(stake * (e.odds - 1));
        runningPL += pl;
        const entry: EntryWithStake = { ...e, stake, plKes: pl, balanceKes: runningPL };
        stake = BASE_STAKE; // reset after win
        return entry;
      } else if (e.outcome === 'lost') {
        const pl = -stake;
        runningPL += pl;
        const entry: EntryWithStake = { ...e, stake, plKes: pl, balanceKes: runningPL };
        stake = stake * LOSS_MULTIPLIER; // 3x next stake
        return entry;
      } else if (isVoid) {
        // Void bets: no stake change, no P&L
        return { ...e, stake: 0, plKes: 0, balanceKes: runningPL };
      } else {
        // Pending: show upcoming stake but no P&L yet
        return { ...e, stake, plKes: 0, balanceKes: runningPL };
      }
    });

    // Reverse back to newest-first for display
    entries.reverse();

    const settledEntries = entries.filter(e => e.outcome === 'won' || e.outcome === 'lost');
    const wins = settledEntries.filter(e => e.outcome === 'won').length;
    const losses = settledEntries.length - wins;
    const hitRatio = settledEntries.length > 0 ? wins / settledEntries.length : 0;
    const totalStaked = settledEntries.reduce((sum, e) => sum + e.stake, 0);

    groups.push({
      month,
      label: dayjs(month + '-01').format('MMMM YYYY'),
      entries,
      total: rawEntries.length,
      settled: settledEntries.length,
      wins,
      losses,
      hitRatio,
      totalPLKes: runningPL,
      totalStaked,
      roi: totalStaked > 0 ? runningPL / totalStaked : 0,
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
  const totalPLKes = monthGroups.reduce((sum, g) => sum + g.totalPLKes, 0);
  const totalStaked = monthGroups.reduce((sum, g) => sum + g.totalStaked, 0);
  const overallRoi = totalStaked > 0 ? totalPLKes / totalStaked : 0;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
          &#127942; Pick of the Day History
          <InfoTip text="Martingale staking: KSh 100 base stake. On loss, next stake is 3x. On win, reset to KSh 100. Resets each month." />
        </h2>
        {summary.settled > 0 && (
          <div className="flex items-center gap-4 text-sm flex-wrap">
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
            <span style={{ color: totalPLKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
              {formatAmount(totalPLKes)}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Staked: <span style={{ fontWeight: 700 }}>{totalStaked.toLocaleString('en-KE')}</span>
            </span>
            <span style={{ color: overallRoi >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
              ROI: {overallRoi >= 0 ? '+' : ''}{(overallRoi * 100).toFixed(1)}%
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
                    <span style={{ color: g.totalPLKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      {formatAmount(g.totalPLKes)}
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Staked: <span style={{ fontWeight: 700 }}>{g.totalStaked.toLocaleString('en-KE')}</span>
                    </span>
                    <span style={{ color: g.roi >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', fontWeight: 700 }}>
                      ROI: {g.roi >= 0 ? '+' : ''}{(g.roi * 100).toFixed(1)}%
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
                    <th className="text-center py-2 px-2 font-medium">Odds</th>
                    <th className="text-center py-2 px-2 font-medium">EV</th>
                    <th className="text-center py-2 px-2 font-medium">Score</th>
                    <th className="text-center py-2 px-2 font-medium">Result</th>
                    <th className="text-right py-2 px-2 font-medium">Stake</th>
                    <th className="text-right py-2 px-2 font-medium">P&L</th>
                    <th className="text-right py-2 px-2 font-medium">Balance</th>
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
                    const isSettled = h.outcome === 'won' || h.outcome === 'lost';
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
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: h.stake > BASE_STAKE ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                          {isVoid ? '-' : h.stake.toLocaleString('en-KE')}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-sm" style={{ color: outcomeColor }}>
                          {isSettled ? formatAmount(h.plKes) : '-'}
                        </td>
                        <td className="py-2.5 px-2 text-right font-bold text-sm" style={{ color: h.balanceKes >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {isSettled || isVoid ? formatAmount(h.balanceKes) : '-'}
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
