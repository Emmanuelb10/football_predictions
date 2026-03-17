import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

const BASE_URL = 'https://v3.football.api-sports.io';
const DAILY_LIMIT = 100;

let dailyRequestCount = 0;
let lastResetDate = new Date().toDateString();

function checkAndResetCounter() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyRequestCount = 0;
    lastResetDate = today;
  }
}

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'x-apisports-key': env.API_FOOTBALL_KEY,
  },
  timeout: 15000,
});

async function apiCall<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
  checkAndResetCounter();

  if (dailyRequestCount >= DAILY_LIMIT) {
    logger.warn(`API-FOOTBALL daily limit reached (${DAILY_LIMIT}). Skipping request to ${endpoint}`);
    throw new Error('Daily API limit reached');
  }

  try {
    dailyRequestCount++;
    logger.info(`API-FOOTBALL [${dailyRequestCount}/${DAILY_LIMIT}] GET ${endpoint} ${JSON.stringify(params)}`);

    const { data } = await client.get(endpoint, { params });

    if (data.errors && Object.keys(data.errors).length > 0) {
      logger.error('API-FOOTBALL error:', data.errors);
      throw new Error(`API error: ${JSON.stringify(data.errors)}`);
    }

    return data.response;
  } catch (error: any) {
    if (error.message === 'Daily API limit reached') throw error;
    logger.error(`API-FOOTBALL request failed: ${error.message}`);
    throw error;
  }
}

export async function getFixturesByDate(date: string) {
  return apiCall<any[]>('/fixtures', { date });
}

export async function getFixturesByLeagueAndDate(leagueId: number, season: number, date: string) {
  return apiCall<any[]>('/fixtures', { league: leagueId, season, date });
}

export async function getPrediction(fixtureId: number) {
  return apiCall<any[]>('/predictions', { fixture: fixtureId });
}

export async function getOdds(fixtureId: number, bookmaker?: number) {
  const params: any = { fixture: fixtureId };
  if (bookmaker) params.bookmaker = bookmaker;
  return apiCall<any[]>('/odds', params);
}

export async function getFixtureById(fixtureId: number) {
  return apiCall<any[]>('/fixtures', { id: fixtureId });
}

export function getRequestCount() {
  checkAndResetCounter();
  return { used: dailyRequestCount, limit: DAILY_LIMIT, remaining: DAILY_LIMIT - dailyRequestCount };
}
