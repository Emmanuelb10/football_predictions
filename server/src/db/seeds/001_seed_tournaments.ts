import type { Knex } from 'knex';

const LEAGUES = [
  { api_football_id: 39, name: 'Premier League', country: 'England', season: 2025 },
  { api_football_id: 140, name: 'La Liga', country: 'Spain', season: 2025 },
  { api_football_id: 135, name: 'Serie A', country: 'Italy', season: 2025 },
  { api_football_id: 78, name: 'Bundesliga', country: 'Germany', season: 2025 },
  { api_football_id: 61, name: 'Ligue 1', country: 'France', season: 2025 },
  { api_football_id: 94, name: 'Primeira Liga', country: 'Portugal', season: 2025 },
  { api_football_id: 88, name: 'Eredivisie', country: 'Netherlands', season: 2025 },
  { api_football_id: 2, name: 'UEFA Champions League', country: 'World', season: 2025 },
  { api_football_id: 3, name: 'UEFA Europa League', country: 'World', season: 2025 },
  { api_football_id: 848, name: 'UEFA Conference League', country: 'World', season: 2025 },
];

export async function seed(knex: Knex): Promise<void> {
  for (const league of LEAGUES) {
    await knex('tournaments')
      .insert(league)
      .onConflict('api_football_id')
      .merge();
  }
}
