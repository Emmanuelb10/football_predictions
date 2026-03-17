import { Pool, QueryResult, PoolClient } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'football_predictions',
  user: 'football_app',
  password: 'football_pass',
  max: 10,
});

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  return pool.query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export default { query, pool, getClient };
