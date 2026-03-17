import { query } from '../config/database';

export interface Tournament {
  id: number;
  api_football_id: number;
  name: string;
  country: string;
  season: number;
  is_active: boolean;
  created_at: Date;
}

export async function findAll(): Promise<Tournament[]> {
  const res = await query('SELECT * FROM tournaments WHERE is_active = true ORDER BY name');
  return res.rows;
}

export async function findByApiId(apiId: number): Promise<Tournament | undefined> {
  const res = await query('SELECT * FROM tournaments WHERE api_football_id = $1', [apiId]);
  return res.rows[0];
}

export async function upsert(data: Partial<Tournament>): Promise<Tournament> {
  const res = await query(
    `INSERT INTO tournaments (api_football_id, name, country, season)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (api_football_id) DO UPDATE SET name = $2, country = $3, season = $4
     RETURNING *`,
    [data.api_football_id, data.name, data.country, data.season]
  );
  return res.rows[0];
}
