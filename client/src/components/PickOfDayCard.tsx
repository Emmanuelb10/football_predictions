import InfoTip from './InfoTip';

interface PickOfDayCardProps {
  data: any;
  loading: boolean;
}

function OddsCell({ label, value, isTipped }: { label: string; value: number | string | null | undefined; isTipped: boolean }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
        <div className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>-</div>
      </div>
    );
  }
  const n = Number(value);
  const isValueRange = n >= 1.50 && n <= 1.99;
  const bg = isTipped
    ? 'rgba(245,158,11,0.18)'
    : isValueRange
    ? 'rgba(34,197,94,0.12)'
    : 'transparent';
  const color = isTipped
    ? 'var(--accent-gold)'
    : isValueRange
    ? 'var(--accent-green)'
    : 'var(--text-primary)';
  return (
    <div
      className="text-center"
      style={{
        background: bg,
        borderRadius: 4,
        padding: '2px 4px',
      }}
    >
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="font-mono text-sm font-bold" style={{ color }}>
        {n.toFixed(2)}
      </div>
    </div>
  );
}

export default function PickOfDayCard({ data, loading }: PickOfDayCardProps) {
  if (loading) {
    return (
      <div className="card animate-pulse" style={{ borderColor: 'var(--accent-gold)', borderWidth: '2px' }}>
        <div className="h-24 rounded" style={{ background: 'var(--bg-primary)' }}></div>
      </div>
    );
  }

  const pick = data?.pick;

  if (!pick) {
    return (
      <div className="card" style={{ borderColor: 'var(--border)' }}>
        <div className="text-center py-4">
          <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-secondary)' }}>
            Pick of the Day
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            No qualifying value bets found for this date.
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Picks require 70%+ win probability, tipped odds 1.50-1.99, and opposing side &gt;= 5.00.
          </p>
        </div>
      </div>
    );
  }

  const tipLabel = pick.tip === '1' ? 'Home Win' : pick.tip === '2' ? 'Away Win' : 'Draw';
  const confidence = (Number(pick.confidence) * 100).toFixed(1);
  const ev = (Number(pick.expected_value) * 100).toFixed(1);
  const kickoff = new Date(pick.kickoff).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  });

  return (
    <div className="card relative overflow-hidden" style={{ borderColor: 'var(--accent-gold)', borderWidth: '2px' }}>
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: 'linear-gradient(90deg, var(--accent-gold), var(--accent-green))' }}
      ></div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">&#127942;</span>
          <h2 className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
            Pick of the Day<InfoTip text="The single best value bet ranked by a composite score of EV, Poisson model, league hit ratio, and line movement" />
          </h2>
        </div>
        <span className="badge badge-green">{tipLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex flex-col items-center md:items-start">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
            {pick.tournament} &middot; {kickoff} EAT
          </p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">{pick.home_team}</span>
            <span style={{ color: 'var(--text-secondary)' }}>vs</span>
            <span className="text-lg font-bold">{pick.away_team}</span>
          </div>
          {pick.status === 'finished' && (() => {
            const actual = pick.home_score > pick.away_score ? '1' : pick.home_score < pick.away_score ? '2' : 'X';
            const won = pick.tip === actual;
            return (
              <p className="text-xl font-bold mt-1" style={{ color: won ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {pick.home_score} - {pick.away_score} {won ? '\u2713' : '\u2717'}
              </p>
            );
          })()}
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Win Prob<InfoTip text="The AI's estimated probability of the tipped outcome winning" /></p>
              <p className="text-2xl font-bold" style={{ color: 'var(--accent-green)' }}>
                {confidence}%
              </p>
            </div>
            <div className="text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Expected Value<InfoTip text="EV = (probability x odds) - 1. Positive EV means profitable long-term" /></p>
              <p
                className="text-2xl font-bold"
                style={{ color: Number(pick.expected_value) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
              >
                {Number(pick.expected_value) > 0 ? '+' : ''}{ev}%
              </p>
            </div>
          </div>
          <div>
            <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              Odds (H / D / A)<InfoTip text="Decimal odds for Home / Draw / Away. Gold = tipped side. Green highlight = value range 1.50-1.99" />
            </p>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <OddsCell label="H" value={pick.home_odds} isTipped={pick.tip === '1'} />
              <OddsCell label="D" value={pick.draw_odds} isTipped={pick.tip === 'X'} />
              <OddsCell label="A" value={pick.away_odds} isTipped={pick.tip === '2'} />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>Confidence</p>
          <div className="w-full rounded-full h-3" style={{ background: 'var(--bg-primary)' }}>
            <div
              className="h-3 rounded-full transition-all"
              style={{
                width: `${confidence}%`,
                background: 'linear-gradient(90deg, var(--accent-gold), var(--accent-green))',
              }}
            ></div>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>0%</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>100%</span>
          </div>
        </div>
      </div>

      {pick.reasoning && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--accent-blue)' }}>AI Analysis: </span>
            {pick.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
