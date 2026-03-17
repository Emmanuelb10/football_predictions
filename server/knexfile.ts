import dotenv from 'dotenv';
import path from 'path';
import type { Knex } from 'knex';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT || '5432';
const db = process.env.DB_NAME || 'football_predictions';
const user = process.env.DB_USER || 'football_app';
const pass = process.env.DB_PASS || 'football_pass';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || `postgresql://${user}:${pass}@${host}:${port}/${db}`,
  migrations: {
    directory: './src/db/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './src/db/seeds',
    extension: 'ts',
  },
  pool: {
    min: 0,
    max: 10,
  },
};

export default config;
module.exports = config;
