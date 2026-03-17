import InfoTip from './InfoTip';

interface DailyPLBannerProps {
  data: {
    totalPicks: number;
    settled: number;
    pending: number;
    wins: number;
    losses: number;
    profitUnits: number;
    streak: { type: 'W' | 'L'; count: number };
  } | undefined;
}

export default function DailyPLBanner({ data }: DailyPLBannerProps) {
  if (!data || data.totalPicks === 0) return null;

  const { wins, losses, pending, profitUnits, streak } = data;
  const isProfit = profitUnits >= 0;
  const streakColor = streak.type === 'W' ? 'var(--accent-green)' : 'var(--accent-red)';

  return (
    <div
      className="card flex flex-wrap items-center justify-between gap-4"
      style={{ borderColor: isProfit ? 'var(--accent-green)' : 'var(--accent-red)', borderWidth: '1px' }}
    >
      {/* Record */}
      <div className="flex items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Today</span>
        <div className="flex items-center gap-1.5">
          <span className="text-lg font-bold" style={{ color: 'var(--accent-green)' }}>{wins}W</span>
          <span style={{ color: 'var(--text-secondary)' }}>-</span>
          <span className="text-lg font-bold" style={{ color: 'var(--accent-red)' }}>{losses}L</span>
          {pending > 0 && (
            <>
              <span style={{ color: 'var(--text-secondary)' }}>-</span>
              <span className="text-lg font-bold" style={{ color: 'var(--accent-yellow)' }}>{pending}P</span>
            </>
          )}
        </div>
      </div>

      {/* Profit */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Profit/Loss<InfoTip text="Standard bet sizing — 1 unit = your base stake. Profit shown in units for consistency" /></p>
        <p
          className="text-2xl font-bold"
          style={{ color: isProfit ? 'var(--accent-green)' : 'var(--accent-red)' }}
        >
          {isProfit ? '+' : ''}{profitUnits} units
        </p>
      </div>

      {/* Streak */}
      <div className="flex items-center gap-2">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Streak<InfoTip text="Consecutive wins (W) or losses (L) across recent settled value bets" /></span>
        <span
          className="px-3 py-1 rounded-full text-sm font-bold"
          style={{ background: `${streakColor}20`, color: streakColor }}
        >
          {streak.type}{streak.count}
          {streak.count >= 5 && streak.type === 'W' ? ' &#128293;' : ''}
        </span>
      </div>
    </div>
  );
}
