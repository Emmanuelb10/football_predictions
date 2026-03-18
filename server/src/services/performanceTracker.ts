import * as PredictionModel from '../models/Prediction';
import { query } from '../config/database';

export async function getPerformanceSummary(days: number = 30) {
  return PredictionModel.getPerformanceStats(days);
}

export async function getDailyBreakdown(days: number = 30) {
  const res = await query(
    `SELECT DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') as date,
            COUNT(*) as total_picks,
            COUNT(*) FILTER (WHERE
              (p.tip = '1' AND m.home_score > m.away_score) OR
              (p.tip = '2' AND m.away_score > m.home_score) OR
              (p.tip = 'X' AND m.home_score = m.away_score)
            ) as wins,
            ROUND(AVG(p.confidence::numeric), 4) as avg_confidence
     FROM predictions p JOIN matches m ON p.match_id = m.id
     WHERE m.status = 'finished' AND p.is_value_bet = true
       AND m.kickoff >= NOW() - ($1 || ' days')::interval
     GROUP BY DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi')
     ORDER BY date DESC`,
    [days]
  );

  return res.rows.map((r: any) => ({
    date: r.date,
    totalPicks: Number(r.total_picks),
    wins: Number(r.wins),
    hitRatio: r.total_picks > 0 ? +(Number(r.wins) / Number(r.total_picks)).toFixed(4) : 0,
    avgConfidence: Number(r.avg_confidence),
  }));
}

export async function getDailyPL(date: string) {
  const res = await query(
    `SELECT p.tip, p.confidence, m.home_score, m.away_score, m.status,
            COALESCE(oh.home_odds, oh.draw_odds, oh.away_odds, 1.8) as used_odds,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
     WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  let wins = 0, losses = 0, pending = 0, profitUnits = 0;
  for (const r of res.rows) {
    if (r.status !== 'finished') { pending++; continue; }
    const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
    const tipOdds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
    if (r.tip === actual) {
      wins++;
      profitUnits += (tipOdds || 1.8) - 1;
    } else {
      losses++;
      profitUnits -= 1;
    }
  }

  // Streak: last 50 settled value bets
  const streakRes = await query(
    `SELECT
       (p.tip = '1' AND m.home_score > m.away_score) OR
       (p.tip = '2' AND m.away_score > m.home_score) OR
       (p.tip = 'X' AND m.home_score = m.away_score) as is_win
     FROM predictions p JOIN matches m ON p.match_id = m.id
     WHERE m.status = 'finished' AND p.is_value_bet = true
     ORDER BY m.kickoff DESC LIMIT 50`
  );

  let streak = 0;
  let streakType: 'W' | 'L' | null = null;
  for (const r of streakRes.rows) {
    const type = r.is_win ? 'W' : 'L';
    if (streakType === null) streakType = type;
    if (type === streakType) streak++;
    else break;
  }

  return {
    totalPicks: res.rows.length,
    settled: wins + losses,
    pending,
    wins,
    losses,
    profitUnits: +profitUnits.toFixed(2),
    streak: { type: streakType || 'W', count: streak },
  };
}

export async function getOddsRangePerformance() {
  const res = await query(
    `SELECT
       CASE
         WHEN oh.home_odds BETWEEN 1.50 AND 1.65 THEN '1.50-1.65'
         WHEN oh.home_odds BETWEEN 1.66 AND 1.85 THEN '1.66-1.85'
         WHEN oh.home_odds BETWEEN 1.86 AND 2.10 THEN '1.86-2.10'
         WHEN oh.home_odds > 2.10 THEN '2.10+'
         ELSE 'unknown'
       END as odds_range,
       COUNT(*) as total_picks,
       COUNT(*) FILTER (WHERE
         (p.tip = '1' AND m.home_score > m.away_score) OR
         (p.tip = '2' AND m.away_score > m.home_score) OR
         (p.tip = 'X' AND m.home_score = m.away_score)
       ) as wins,
       ROUND(AVG(oh.home_odds), 2) as avg_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
     WHERE m.status = 'finished' AND p.is_value_bet = true
     GROUP BY odds_range ORDER BY odds_range`
  );

  return res.rows.map((r: any) => ({
    oddsRange: r.odds_range,
    totalPicks: Number(r.total_picks),
    hitRatio: +(Number(r.wins) / Math.max(Number(r.total_picks), 1)).toFixed(4),
    avgOdds: Number(r.avg_odds),
    roi: +(((Number(r.wins) * Number(r.avg_odds) - Number(r.total_picks)) / Math.max(Number(r.total_picks), 1)) * 100).toFixed(2),
  }));
}
