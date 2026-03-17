import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://football_app:football_pass@localhost:5432/football_predictions'),
  API_FOOTBALL_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  CLAUDE_API_KEY: z.string().default(''),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const env = envSchema.parse(process.env);
