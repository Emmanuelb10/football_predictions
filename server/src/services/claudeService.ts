import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(messages: Array<{ role: 'user' | 'assistant'; content: string }>, maxTokens = 4096): Promise<string | null> {
  if (!env.CLAUDE_API_KEY) {
    logger.error('CLAUDE_API_KEY not set');
    return null;
  }

  try {
    const { data } = await axios.post(
      CLAUDE_API_URL,
      {
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        messages,
      },
      {
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 90000,
      }
    );
    return data.content?.[0]?.text || null;
  } catch (error: any) {
    const status = error.response?.status;
    const msg = error.response?.data?.error?.message || error.message;
    logger.error(`Claude API error (${status}): ${msg}`);
    return null;
  }
}

// ---------- Fixtures ----------

export interface ScrapedFixture {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed';
  homeScore?: number;
  awayScore?: number;
}

export async function fetchFixtures(date: string): Promise<ScrapedFixture[]> {
  const dayOfWeek = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long' });

  const prompt = `You are a football fixture generator for a predictions app. Generate a realistic set of football matches for ${date} (${dayOfWeek}) across Europe's top leagues.

Use the ACTUAL teams from the 2025-2026 season for each league. Generate a realistic matchday — the number of games should match what typically happens on a ${dayOfWeek}:
- Saturday: Usually 6-10 Premier League matches, 5-8 matches in La Liga, Serie A, Bundesliga, Ligue 1
- Sunday: Usually 2-4 Premier League matches, 3-5 in other leagues
- Midweek (Tue/Wed): Champions League or Europa League matchdays (4-8 games)
- If it's an international break or off-season, return an empty array []

Use realistic kickoff times (UTC):
- Premier League Saturday: 12:30, 15:00 (most), 17:30
- Premier League Sunday: 14:00, 16:30
- La Liga: 13:00, 15:15, 17:30, 20:00
- Serie A: 14:00, 17:00, 19:45
- Bundesliga Saturday: 14:30 (most), 17:30
- Ligue 1: 16:00, 20:00
- Champions League: 17:45, 20:00

Teams for 2025-2026 season:
PREMIER LEAGUE: Arsenal, Aston Villa, Bournemouth, Brentford, Brighton, Chelsea, Crystal Palace, Everton, Fulham, Ipswich Town, Leicester City, Liverpool, Manchester City, Manchester United, Newcastle United, Nottingham Forest, Southampton, Tottenham Hotspur, West Ham United, Wolverhampton Wanderers
LA LIGA: Athletic Bilbao, Atletico Madrid, Barcelona, Celta Vigo, Espanyol, Getafe, Girona, Las Palmas, Leganes, Mallorca, Osasuna, Rayo Vallecano, Real Betis, Real Madrid, Real Sociedad, Real Valladolid, Sevilla, Valencia, Villarreal, Deportivo Alaves
SERIE A: AC Milan, Atalanta, Bologna, Cagliari, Como, Empoli, Fiorentina, Genoa, Hellas Verona, Inter Milan, Juventus, Lazio, Lecce, Monza, Napoli, Parma, Roma, Torino, Udinese, Venezia
BUNDESLIGA: Augsburg, Bayer Leverkusen, Bayern Munich, Borussia Dortmund, Borussia Monchengladbach, Eintracht Frankfurt, Freiburg, Heidenheim, Hoffenheim, Holstein Kiel, Mainz, RB Leipzig, St. Pauli, Stuttgart, Union Berlin, VfL Bochum, VfL Wolfsburg, Werder Bremen
LIGUE 1: Angers, Auxerre, Brest, Le Havre, Lens, Lille, Lyon, Marseille, Monaco, Montpellier, Nantes, Nice, Paris Saint-Germain, Reims, Rennes, Saint-Etienne, Strasbourg, Toulouse

Each team should appear AT MOST ONCE. Pair them randomly but realistically (alternate home/away).

Respond with ONLY a JSON array:
[{"homeTeam":"X","awayTeam":"Y","league":"Premier League","country":"England","kickoff":"15:00","status":"scheduled"}]`;

  const text = await callClaude([{ role: 'user', content: prompt }], 8192);
  if (!text) return [];

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const fixtures: ScrapedFixture[] = JSON.parse(jsonMatch[0]);
    logger.info(`Claude returned ${fixtures.length} fixtures for ${date}`);
    return fixtures;
  } catch (error) {
    logger.error(`Failed to parse Claude fixtures: ${error}`);
    return [];
  }
}

// ---------- Predictions ----------

export interface AIPrediction {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  tip: string;
  reasoning: string;
}

export async function predictMatches(
  matches: Array<{ id: number; homeTeam: string; awayTeam: string; league: string; country: string; kickoff: string }>
): Promise<Map<number, AIPrediction & { estimatedOdds: { home: number; draw: number; away: number } }>> {
  if (matches.length === 0) return new Map();

  const matchList = matches
    .map((m, i) => `${i + 1}. [ID:${m.id}] ${m.homeTeam} vs ${m.awayTeam} | ${m.league} (${m.country}) | ${m.kickoff} UTC`)
    .join('\n');

  const prompt = `You are an expert football analyst. Predict these matches with probabilities and estimated betting odds.

MATCHES:
${matchList}

Consider team quality, home advantage (+5-10%), squad depth, and league context.

Respond with ONLY a JSON array:
[{"id":<match_id>,"home_win_prob":0.XX,"draw_prob":0.XX,"away_win_prob":0.XX,"tip":"1","reasoning":"Brief analysis","estimated_odds":{"home":1.XX,"draw":X.XX,"away":X.XX}}]

Rules:
- Probabilities MUST sum to 1.00
- "tip" = "1" (home), "X" (draw), or "2" (away)
- Strong favorites: odds 1.25-1.60, prob 60-80%
- Slight favorites: odds 1.70-2.20, prob 45-58%
- Even matches: home ~2.40-2.80, draw ~3.20-3.60
- Be differentiated — not all matches are the same`;

  const text = await callClaude([{ role: 'user', content: prompt }], 8192);
  if (!text) return new Map();

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();
    const predictions: any[] = JSON.parse(jsonMatch[0]);

    const result = new Map<number, AIPrediction & { estimatedOdds: { home: number; draw: number; away: number } }>();
    for (const p of predictions) {
      const h = Number(p.home_win_prob), d = Number(p.draw_prob), a = Number(p.away_win_prob);
      if (isNaN(h) || isNaN(d) || isNaN(a)) continue;
      const total = h + d + a;
      if (total <= 0) continue;

      result.set(p.id, {
        homeWinProb: h / total, drawProb: d / total, awayWinProb: a / total,
        confidence: Math.max(h, d, a) / total,
        tip: p.tip || '1',
        reasoning: p.reasoning || '',
        estimatedOdds: {
          home: Number(p.estimated_odds?.home) || 2.0,
          draw: Number(p.estimated_odds?.draw) || 3.5,
          away: Number(p.estimated_odds?.away) || 3.5,
        },
      });
    }

    logger.info(`Claude predicted ${result.size}/${matches.length} matches`);
    return result;
  } catch (error) {
    logger.error(`Failed to parse predictions: ${error}`);
    return new Map();
  }
}

// ---------- Results ----------

export async function fetchResults(
  matches: Array<{ id: number; homeTeam: string; awayTeam: string; league: string; kickoff: string }>
): Promise<Map<number, { homeScore: number; awayScore: number; status: string }>> {
  if (matches.length === 0) return new Map();

  const matchList = matches
    .map((m, i) => `${i + 1}. [ID:${m.id}] ${m.homeTeam} vs ${m.awayTeam} | ${m.league} | ${m.kickoff}`)
    .join('\n');

  const prompt = `These football matches should have finished. Provide final scores you are confident about.

MATCHES:
${matchList}

Respond with ONLY a JSON array:
[{"id":<match_id>,"home_score":X,"away_score":X,"status":"finished"}]

If you don't know a result, set status to "unknown" with scores -1.`;

  const text = await callClaude([{ role: 'user', content: prompt }]);
  if (!text) return new Map();

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();
    const results: any[] = JSON.parse(jsonMatch[0]);
    const map = new Map<number, { homeScore: number; awayScore: number; status: string }>();
    for (const r of results) {
      if (r.status === 'unknown' || r.home_score < 0) continue;
      map.set(r.id, { homeScore: Number(r.home_score), awayScore: Number(r.away_score), status: 'finished' });
    }
    logger.info(`Claude returned ${map.size} results`);
    return map;
  } catch (error) {
    logger.error(`Failed to parse results: ${error}`);
    return new Map();
  }
}
