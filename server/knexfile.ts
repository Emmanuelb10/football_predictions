import dotenv from 'dotenv';
import path from 'path';
import type { Knex } from 'knex';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgresql://football_app:football_pass@localhost:5432/football_predictions',
  migrations: {
    directory: './src/db/migrations',
    extension: 'ts',
  },
  seeds: {
    directory: './src/db/seeds',
    extension: 'ts',
  },
  pool: {
    min: 2,
    max: 10,
  },
};

export default config;
module.exports = config;
