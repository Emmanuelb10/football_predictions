import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

export async function fetchMatches(date: string) {
  const { data } = await api.get(`/matches?date=${date}`);
  return data;
}

export async function fetchPickOfDay(date: string) {
  const { data } = await api.get(`/predictions/pick-of-day?date=${date}`);
  return data;
}

export async function fetchPerformance(days: number = 30) {
  const { data } = await api.get(`/performance?days=${days}`);
  return data;
}

export async function fetchHealth() {
  const { data } = await api.get('/health');
  return data;
}

export async function triggerIngest() {
  const { data } = await api.post('/trigger/ingest');
  return data;
}

export async function triggerOddsSync() {
  const { data } = await api.post('/trigger/odds');
  return data;
}

export async function triggerResultSync() {
  const { data } = await api.post('/trigger/results');
  return data;
}

export async function fetchDailyPL(date: string) {
  const { data } = await api.get(`/performance/daily?date=${date}`);
  return data;
}

export async function fetchAccumulators(date: string) {
  const { data } = await api.get(`/predictions/accumulators?date=${date}`);
  return data;
}

export async function fetchSettled(since: string) {
  const { data } = await api.get(`/matches/settled?since=${since}`);
  return data;
}

export async function fetchPotdHistory(days: number = 30) {
  const { data } = await api.get(`/predictions/potd-history?days=${days}`);
  return data;
}
