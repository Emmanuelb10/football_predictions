import { query } from '../config/database';

export interface Prediction {
  id: number;
  match_id: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  tip: string;
  confidence: number;
  expected_value: number;
  is_value_bet: boolean;
  is_pick_of_day: boolean;
  potd_rank_score: number | null;
  poisson_score: number | null;
  league_hit_ratio: number | null;
  std_deviation: number | null;
  line_movement: number | null;
  source: string;
  reasoning: string;
}

export async function upsert(data: Partial<Prediction>): Promise<Prediction> {
  const res = await query(
    `INSERT INTO predictions (match_id, home_win_prob, draw_prob, away_win_prob, tip, confidence,
       expected_value, is_value_bet, is_pick_of_day, potd_rank_score, poisson_score,
       league_hit_ratio, std_deviation, line_movement, source, reasoning)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (match_id) DO UPDATE SET
       home_win_prob=$2, draw_prob=$3, away_win_prob=$4, tip=$5, confidence=$6,
       expected_value=$7, is_value_bet=$8, poisson_score=$11,
       league_hit_ratio=$12, source=$15, reasoning=$16
     RETURNING *`,
    [
      data.match_id, data.home_win_prob, data.draw_prob, data.away_win_prob,
      data.tip, data.confidence, data.expected_value ?? 0, data.is_value_bet ?? false,
      data.is_pick_of_day ?? false, data.potd_rank_score ?? null, data.poisson_score ?? null,
      data.league_hit_ratio ?? null, data.std_deviation ?? null, data.line_movement ?? null,
      data.source ?? 'claude', data.reasoning ?? '',
    ]
  );
  return res.rows[0];
}

export async function findPickOfDay(date: string) {
  const res = await query(
    `SELECT m.id as match_id, m.kickoff, m.status, m.home_score, m.away_score,
            ht.name as home_team, ht.logo_url as home_logo,
            at2.name as away_team, at2.logo_url as away_logo,
            t.name as tournament, p.*,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
     WHERE p.is_pick_of_day = true
       AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1
     LIMIT 1`,
    [date]
  );
  return res.rows[0] || null;
}

export async function clearPickOfDay(date: string) {
  return query(
    `UPDATE predictions SET is_pick_of_day = false
     WHERE match_id IN (SELECT id FROM matches WHERE DATE(kickoff AT TIME ZONE 'Africa/Nairobi') = $1)`,
    [date]
  );
}

export async function getPerformanceStats(days: number) {
  const res = await query(
    `SELECT m.home_score, m.away_score, p.tip, p.confidence,
            p.home_win_prob, p.draw_prob, p.away_win_prob, t.name as tournament
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN tournaments t ON m.tournament_id = t.id
     WHERE m.status = 'finished' AND p.is_value_bet = true
       AND m.kickoff >= NOW() - ($1 || ' days')::interval`,
    [days]
  );

  const results = res.rows;
  if (results.length === 0) {
    return { hitRatio: 0, roi: 0, brierScore: 0, logLoss: 0, totalPicks: 0, wins: 0, losses: 0, byLeague: {} };
  }

  let wins = 0;
  let totalProfit = 0;
  let brierSum = 0;
  let logLossSum = 0;
  const leagueStats: Record<string, { wins: number; total: number }> = {};

  for (const r of results) {
    const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
    const isWin = r.tip === actual;
    if (isWin) wins++;
    totalProfit += isWin ? 0.58 : -1;

    const actualArr = r.tip === '1' ? [1, 0, 0] : r.tip === 'X' ? [0, 1, 0] : [0, 0, 1];
    const probs = [Number(r.home_win_prob), Number(r.draw_prob), Number(r.away_win_prob)];
    brierSum += actualArr.reduce((s, a, i) => s + (a - probs[i]) ** 2, 0);

    const predProb = Math.max(0.01, Math.min(0.99, Number(r.confidence)));
    const y = isWin ? 1 : 0;
    logLossSum += -(y * Math.log(predProb) + (1 - y) * Math.log(1 - predProb));

    if (!leagueStats[r.tournament]) leagueStats[r.tournament] = { wins: 0, total: 0 };
    leagueStats[r.tournament].total++;
    if (isWin) leagueStats[r.tournament].wins++;
  }

  const total = results.length;
  return {
    hitRatio: +(wins / total).toFixed(4),
    roi: +((totalProfit / total) * 100).toFixed(2),
    brierScore: +(brierSum / total).toFixed(4),
    logLoss: +(logLossSum / total).toFixed(4),
    totalPicks: total,
    wins,
    losses: total - wins,
    byLeague: Object.fromEntries(
      Object.entries(leagueStats).map(([k, v]) => [k, { ...v, hitRatio: +(v.wins / v.total).toFixed(4) }])
    ),
  };
}
