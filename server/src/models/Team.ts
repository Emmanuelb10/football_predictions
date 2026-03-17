import { query } from '../config/database';

export interface Team {
  id: number;
  api_football_id: number;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  tournament_id: number | null;
  created_at: Date;
}

export async function findByApiId(apiId: number): Promise<Team | undefined> {
  const res = await query('SELECT * FROM teams WHERE api_football_id = $1', [apiId]);
  return res.rows[0];
}

export async function upsert(data: Partial<Team>): Promise<Team> {
  const res = await query(
    `INSERT INTO teams (api_football_id, name, logo_url, tournament_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (api_football_id) DO UPDATE SET name = $2, logo_url = COALESCE($3, teams.logo_url), tournament_id = $4
     RETURNING *`,
    [data.api_football_id, data.name, data.logo_url || null, data.tournament_id || null]
  );
  return res.rows[0];
}
