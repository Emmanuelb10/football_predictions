interface PickOfDayCardProps {
  data: any;
  loading: boolean;
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
            Picks require 70%+ win probability and odds {'>'} 1.50
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
  });

  return (
    <div className="card relative overflow-hidden" style={{ borderColor: 'var(--accent-gold)', borderWidth: '2px' }}>
      {/* Gold accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: 'linear-gradient(90deg, var(--accent-gold), var(--accent-green))' }}
      ></div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">&#127942;</span>
          <h2 className="text-lg font-bold" style={{ color: 'var(--accent-gold)' }}>
            Pick of the Day
          </h2>
        </div>
        <span className="badge badge-green">{tipLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Teams */}
        <div className="flex flex-col items-center md:items-start">
          <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
            {pick.tournament} &middot; {kickoff} UTC
          </p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold">{pick.home_team}</span>
            <span style={{ color: 'var(--text-secondary)' }}>vs</span>
            <span className="text-lg font-bold">{pick.away_team}</span>
          </div>
          {pick.status === 'finished' && (
            <p className="text-xl font-bold mt-1" style={{ color: 'var(--accent-blue)' }}>
              {pick.home_score} - {pick.away_score}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-6 justify-center">
          <div className="text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Win Prob</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--accent-green)' }}>
              {confidence}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Expected Value</p>
            <p
              className="text-2xl font-bold"
              style={{ color: Number(pick.expected_value) > 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
            >
              {Number(pick.expected_value) > 0 ? '+' : ''}{ev}%
            </p>
          </div>
        </div>

        {/* Confidence meter */}
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
    </div>
  );
}
