import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function callClaude(messages: ClaudeMessage[], maxTokens = 4096): Promise<string | null> {
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
        timeout: 60000,
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
  kickoff: string; // HH:MM UTC
  status: 'scheduled' | 'live' | 'finished' | 'postponed';
  homeScore?: number;
  awayScore?: number;
}

/**
 * Ask Claude to provide today's real scheduled football matches
 * for the major leagues we track.
 */
export async function fetchFixtures(date: string): Promise<ScrapedFixture[]> {
  const prompt = `You are a football data assistant. I need the REAL scheduled football matches for ${date} across these leagues:
- Premier League (England)
- La Liga (Spain)
- Serie A (Italy)
- Bundesliga (Germany)
- Ligue 1 (France)
- Primeira Liga (Portugal)
- Eredivisie (Netherlands)
- UEFA Champions League
- UEFA Europa League
- UEFA Conference League

Based on the actual 2025-2026 season fixture schedules that have been published, provide all matches scheduled for this date.

IMPORTANT: Only include matches you are confident are actually scheduled. If you are not sure about a specific date's fixtures, include only the ones you are certain about. It's better to return fewer accurate matches than to guess.

Respond with ONLY a JSON array, no other text:
[
  {
    "homeTeam": "Team Name",
    "awayTeam": "Team Name",
    "league": "League Name",
    "country": "Country",
    "kickoff": "HH:MM",
    "status": "scheduled"
  }
]

If there are no matches scheduled for this date in these leagues, return an empty array: []`;

  const text = await callClaude([{ role: 'user', content: prompt }]);
  if (!text) return [];

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const fixtures: ScrapedFixture[] = JSON.parse(jsonMatch[0]);
    logger.info(`Claude returned ${fixtures.length} fixtures for ${date}`);
    return fixtures;
  } catch (error) {
    logger.error(`Failed to parse Claude fixtures response: ${error}`);
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

/**
 * Ask Claude to predict outcomes and provide odds estimates for a batch of matches.
 * Batching saves API calls vs one-by-one.
 */
export async function predictMatches(
  matches: Array<{ id: number; homeTeam: string; awayTeam: string; league: string; country: string; kickoff: string }>
): Promise<Map<number, AIPrediction & { estimatedOdds: { home: number; draw: number; away: number } }>> {
  if (matches.length === 0) return new Map();

  const matchList = matches
    .map((m, i) => `${i + 1}. [ID:${m.id}] ${m.homeTeam} vs ${m.awayTeam} | ${m.league} (${m.country}) | ${m.kickoff} UTC`)
    .join('\n');

  const prompt = `You are an expert football analyst AI. Analyze these upcoming matches and provide win probability predictions AND estimated 1X2 betting odds for each.

MATCHES:
${matchList}

For each match, consider:
- Team quality and squad depth in the current 2025-2026 season
- Home advantage (typically +5-10% for home team)
- Recent form and league standings
- Historical head-to-head patterns
- Tactical matchups and playing styles

Respond with ONLY a JSON array, no other text. One object per match:
[
  {
    "id": <match_id>,
    "home_win_prob": 0.XX,
    "draw_prob": 0.XX,
    "away_win_prob": 0.XX,
    "tip": "1",
    "reasoning": "Brief 1-2 sentence analysis",
    "estimated_odds": { "home": 1.XX, "draw": X.XX, "away": X.XX }
  }
]

Rules:
- Probabilities MUST sum to 1.00
- "tip" = "1" (home), "X" (draw), or "2" (away) — the outcome with the highest probability
- "estimated_odds" = realistic decimal betting odds (e.g., strong favorite ~1.30-1.60, slight favorite ~1.70-2.10, draw ~3.00-3.80, underdog ~3.00-8.00)
- Be realistic and differentiated — don't give all matches similar probabilities`;

  const text = await callClaude([{ role: 'user', content: prompt }], 8192);
  if (!text) return new Map();

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();
    const predictions: any[] = JSON.parse(jsonMatch[0]);

    const result = new Map<number, AIPrediction & { estimatedOdds: { home: number; draw: number; away: number } }>();

    for (const p of predictions) {
      const homeProb = Number(p.home_win_prob);
      const drawProb = Number(p.draw_prob);
      const awayProb = Number(p.away_win_prob);
      if (isNaN(homeProb) || isNaN(drawProb) || isNaN(awayProb)) continue;

      // Normalize
      const total = homeProb + drawProb + awayProb;
      if (total <= 0) continue;

      result.set(p.id, {
        homeWinProb: homeProb / total,
        drawProb: drawProb / total,
        awayWinProb: awayProb / total,
        confidence: Math.max(homeProb, drawProb, awayProb) / total,
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
    logger.error(`Failed to parse Claude predictions response: ${error}`);
    return new Map();
  }
}

// ---------- Results ----------

/**
 * Ask Claude for final scores of matches that should have finished.
 */
export async function fetchResults(
  matches: Array<{ id: number; homeTeam: string; awayTeam: string; league: string; kickoff: string }>
): Promise<Map<number, { homeScore: number; awayScore: number; status: string }>> {
  if (matches.length === 0) return new Map();

  const matchList = matches
    .map((m, i) => `${i + 1}. [ID:${m.id}] ${m.homeTeam} vs ${m.awayTeam} | ${m.league} | Kickoff: ${m.kickoff}`)
    .join('\n');

  const prompt = `You are a football data assistant. These matches should have been completed. Provide the final scores.

MATCHES:
${matchList}

Respond with ONLY a JSON array:
[
  { "id": <match_id>, "home_score": X, "away_score": X, "status": "finished" }
]

Rules:
- Only include matches you are CONFIDENT about the result
- If you don't know a result, set status to "unknown" and scores to -1
- Use actual real match results, do not fabricate scores`;

  const text = await callClaude([{ role: 'user', content: prompt }]);
  if (!text) return new Map();

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();
    const results: any[] = JSON.parse(jsonMatch[0]);

    const map = new Map<number, { homeScore: number; awayScore: number; status: string }>();
    for (const r of results) {
      if (r.status === 'unknown' || r.home_score < 0) continue;
      map.set(r.id, {
        homeScore: Number(r.home_score),
        awayScore: Number(r.away_score),
        status: r.status || 'finished',
      });
    }

    logger.info(`Claude returned ${map.size} results out of ${matches.length} requested`);
    return map;
  } catch (error) {
    logger.error(`Failed to parse Claude results response: ${error}`);
    return new Map();
  }
}
