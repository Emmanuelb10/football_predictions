import { query } from '../config/database';

export interface Match {
  id: number;
  api_football_id: number;
  tournament_id: number;
  home_team_id: number;
  away_team_id: number;
  kickoff: Date;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

export async function findByDate(date: string) {
  const res = await query(
    `SELECT m.id, m.api_football_id, m.kickoff, m.status, m.home_score, m.away_score,
            ht.name as home_team, ht.logo_url as home_logo,
            at2.name as away_team, at2.logo_url as away_logo,
            t.name as tournament, t.country as tournament_country,
            p.home_win_prob, p.draw_prob, p.away_win_prob, p.tip,
            p.confidence, p.expected_value, p.is_value_bet, p.is_pick_of_day, p.potd_rank_score
     FROM matches m
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN predictions p ON m.id = p.match_id
     WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1
     ORDER BY p.expected_value DESC NULLS LAST, p.confidence DESC NULLS LAST, m.kickoff ASC`,
    [date]
  );
  return res.rows;
}

export async function upsert(data: Partial<Match>): Promise<Match> {
  const res = await query(
    `INSERT INTO matches (api_football_id, tournament_id, home_team_id, away_team_id, kickoff, status, home_score, away_score, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (api_football_id) DO UPDATE SET
       status = CASE WHEN matches.status = 'finished' THEN matches.status ELSE COALESCE($6, matches.status) END,
       updated_at = NOW()
     RETURNING *`,
    [data.api_football_id, data.tournament_id, data.home_team_id, data.away_team_id, data.kickoff, data.status, data.home_score ?? null, data.away_score ?? null]
  );
  return res.rows[0];
}

export async function updateResult(matchId: number, homeScore: number, awayScore: number, status: string) {
  return query(
    `UPDATE matches SET home_score = $1, away_score = $2, status = $3, updated_at = NOW() WHERE id = $4`,
    [homeScore, awayScore, status, matchId]
  );
}

export async function findPendingResults() {
  const res = await query(
    `SELECT * FROM matches WHERE status = 'scheduled' AND kickoff < NOW() - INTERVAL '105 minutes'`
  );
  return res.rows;
}

export async function findStaleScheduled() {
  // Matches still 'scheduled' but kickoff was 48+ hours ago — likely postponed/cancelled
  const res = await query(
    `SELECT * FROM matches WHERE status = 'scheduled' AND kickoff < NOW() - INTERVAL '48 hours'`
  );
  return res.rows;
}
