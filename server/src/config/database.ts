import { Pool, QueryResult, PoolClient } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'football_predictions',
  user: process.env.DB_USER || 'football_app',
  password: process.env.DB_PASS || 'football_pass',
  max: 10,
});

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  return pool.query(text, params);
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export default { query, pool, getClient };
