import { query } from '../config/database';

export interface OddsHistoryRecord {
  id: number;
  match_id: number;
  bookmaker: string;
  market: string;
  home_odds: number;
  draw_odds: number;
  away_odds: number;
  scraped_at: Date;
}

export async function insert(data: Partial<OddsHistoryRecord>): Promise<OddsHistoryRecord> {
  const res = await query(
    `INSERT INTO odds_history (match_id, bookmaker, market, home_odds, draw_odds, away_odds)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [data.match_id, data.bookmaker || '1xbet', data.market || '1x2', data.home_odds, data.draw_odds, data.away_odds]
  );
  return res.rows[0];
}

export async function getLatestOdds(matchId: number, bookmaker?: string) {
  const res = bookmaker
    ? await query(
        'SELECT * FROM odds_history WHERE match_id = $1 AND bookmaker = $2 ORDER BY scraped_at DESC LIMIT 1',
        [matchId, bookmaker]
      )
    : await query(
        'SELECT * FROM odds_history WHERE match_id = $1 ORDER BY scraped_at DESC LIMIT 1',
        [matchId]
      );
  return res.rows[0] || null;
}

export async function getOddsForMatches(matchIds: number[]) {
  if (matchIds.length === 0) return [];
  const placeholders = matchIds.map((_, i) => `$${i + 1}`).join(',');
  const res = await query(
    `SELECT DISTINCT ON (match_id, bookmaker) *
     FROM odds_history
     WHERE match_id IN (${placeholders})
     ORDER BY match_id, bookmaker, scraped_at DESC`,
    matchIds
  );
  return res.rows;
}

export async function getLineMovement(matchId: number) {
  const res = await query(
    'SELECT * FROM odds_history WHERE match_id = $1 ORDER BY scraped_at ASC',
    [matchId]
  );
  if (res.rows.length < 2) return 0;
  const first = res.rows[0];
  const last = res.rows[res.rows.length - 1];
  return {
    home: Number(first.home_odds) - Number(last.home_odds),
    draw: Number(first.draw_odds) - Number(last.draw_odds),
    away: Number(first.away_odds) - Number(last.away_odds),
  };
}
