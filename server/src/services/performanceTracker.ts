import * as PredictionModel from '../models/Prediction';
import { query } from '../config/database';

export async function getPerformanceSummary(days: number = 30) {
  return PredictionModel.getPerformanceStats(days);
}

export async function getDailyBreakdown(days: number = 30) {
  const res = await query(
    `SELECT DATE(m.kickoff AT TIME ZONE 'UTC') as date,
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
     GROUP BY DATE(m.kickoff AT TIME ZONE 'UTC')
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
