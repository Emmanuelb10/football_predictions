import axios from 'axios';
import { query } from '../config/database';
import logger from '../config/logger';
import { env } from '../config/env';
import * as PredictionModel from '../models/Prediction';
import * as OddsModel from '../models/OddsHistory';
import { calculateEV, isValueBet } from '../utils/expectedValue';
import { poissonMatchProbs, poissonAgreementScore } from '../utils/poisson';

interface MatchInfo {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
}

interface PredictionInput {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  tip: string;
  reasoning: string;
}

export async function processAIPrediction(
  matchId: number,
  matchInfo: MatchInfo,
  matchApiId: number,
  precomputed?: PredictionInput
) {
  try {
    if (!precomputed) {
      logger.warn(`No prediction for match ${matchApiId} (${matchInfo.homeTeam} vs ${matchInfo.awayTeam})`);
      return null;
    }
    return await storePrediction(matchId, precomputed, matchApiId, 'claude');
  } catch (error: any) {
    logger.error(`Failed to store prediction for match ${matchApiId}: ${error.message}`);
    return null;
  }
}

async function storePrediction(matchId: number, pred: PredictionInput, matchApiId: number, source: string) {
  const { homeWinProb, drawProb, awayWinProb, tip, confidence } = pred;

  const odds = await OddsModel.getLatestOdds(matchId);
  let ev = 0;
  let valueBet = false;

  if (odds) {
    const tipOdds =
      tip === '1' ? Number(odds.home_odds) :
      tip === 'X' ? Number(odds.draw_odds) :
      Number(odds.away_odds);
    ev = calculateEV(confidence, tipOdds);
    valueBet = isValueBet(confidence, tipOdds);
  }

  const poissonScore = computePoissonFromProbs(homeWinProb, drawProb, awayWinProb);
  const leagueHitRatio = await getLeagueHitRatio(matchId);

  const prediction = await PredictionModel.upsert({
    match_id: matchId,
    home_win_prob: homeWinProb,
    draw_prob: drawProb,
    away_win_prob: awayWinProb,
    tip, confidence,
    expected_value: ev,
    is_value_bet: valueBet,
    poisson_score: poissonScore,
    league_hit_ratio: leagueHitRatio,
    source,
    reasoning: pred.reasoning || '',
  });

  logger.info(`Prediction [${source}] match ${matchApiId}: tip=${tip}, conf=${(confidence * 100).toFixed(1)}%, ev=${ev.toFixed(4)}, value=${valueBet}`);
  return prediction;
}

function computePoissonFromProbs(homeProb: number, drawProb: number, awayProb: number): number {
  const homeXG = 0.8 + homeProb * 1.5;
  const awayXG = 0.8 + awayProb * 1.5;
  const pProbs = poissonMatchProbs(homeXG, awayXG);
  return poissonAgreementScore({ home: homeProb, draw: drawProb, away: awayProb }, pProbs);
}

async function getLeagueHitRatio(matchId: number): Promise<number> {
  try {
    const res = await query(
      `SELECT COUNT(*) FILTER (WHERE
          (p.tip = '1' AND m2.home_score > m2.away_score) OR
          (p.tip = '2' AND m2.away_score > m2.home_score) OR
          (p.tip = 'X' AND m2.home_score = m2.away_score)
        )::float / NULLIF(COUNT(*), 0) as hit_ratio
       FROM predictions p JOIN matches m2 ON p.match_id = m2.id
       WHERE m2.tournament_id = (SELECT tournament_id FROM matches WHERE id = $1)
         AND m2.status = 'finished' AND p.is_value_bet = true`,
      [matchId]
    );
    return res.rows[0]?.hit_ratio || 0.5;
  } catch {
    return 0.5;
  }
}

async function tryClaudePOTD(prompt: string): Promise<{ pick: number; reasoning: string } | null> {
  if (!env.CLAUDE_API_KEY) return null;
  try {
    const { data: response } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );
    const aiText = response.content?.[0]?.text || '';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info(`Claude POTD: ${parsed.reasoning}`);
      return parsed;
    }
  } catch (err: any) {
    logger.warn(`Claude POTD failed: ${err.response?.data?.error?.message || err.message}`);
  }
  return null;
}

async function tryGeminiPOTD(prompt: string): Promise<{ pick: number; reasoning: string } | null> {
  if (!env.GEMINI_API_KEY) return null;
  try {
    const { data: response } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 2048 } },
      },
      { timeout: 30000 }
    );
    const aiText = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info(`Gemini POTD: ${parsed.reasoning}`);
      return parsed;
    }
  } catch (err: any) {
    logger.warn(`Gemini POTD failed: ${err.response?.data?.error?.message || err.message}`);
  }
  return null;
}

export async function selectPickOfDay(date: string) {
  const res = await query(
    `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
            TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
     WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );
  const valueBets = res.rows;

  if (valueBets.length === 0) {
    logger.info(`No value bets for ${date}`);
    return null;
  }

  await PredictionModel.clearPickOfDay(date);

  // Build match summaries for Claude
  const matchSummaries = valueBets.map((vb, i) => {
    const tipLabel = vb.tip === '1' ? 'Home Win' : vb.tip === '2' ? 'Away Win' : 'Draw';
    const tipOdds = vb.tip === '1' ? Number(vb.home_odds) : vb.tip === 'X' ? Number(vb.draw_odds) : Number(vb.away_odds);
    return `${i + 1}. ${vb.home_team} vs ${vb.away_team} (${vb.league}, ${vb.kickoff_time} EAT)
   Tip: ${tipLabel} | Probability: ${(Number(vb.confidence) * 100).toFixed(0)}% | Odds: ${tipOdds?.toFixed(2) || 'N/A'} | EV: ${Number(vb.expected_value) > 0 ? '+' : ''}${(Number(vb.expected_value) * 100).toFixed(1)}%
   Poisson: ${Number(vb.poisson_score).toFixed(2)} | League hit ratio: ${(Number(vb.league_hit_ratio) * 100).toFixed(0)}%`;
  }).join('\n');

  const aiPrompt = `You are an expert football betting analyst. Select the SINGLE BEST value bet as Pick of the Day from these candidates for ${date}.

${matchSummaries}

Evaluate each match considering:
- Expected Value (higher EV = more profitable edge)
- Win probability vs odds (is the bookmaker underestimating this team?)
- League reliability (higher hit ratio = more predictable league)
- Poisson model agreement (higher = stats back the prediction)
- Team quality, home advantage, and current form context
- Risk vs reward balance

Respond with ONLY valid JSON (no markdown):
{"pick": <number 1-${valueBets.length}>, "reasoning": "<2-3 sentence analysis explaining why this is the best pick, referencing the specific teams and stats>"}`;

  let winnerId = valueBets[0].id;
  let reasoning = '';

  // Try Gemini first (free), then Claude, then fall back to highest EV
  const aiResult = await tryGeminiPOTD(aiPrompt) || await tryClaudePOTD(aiPrompt);

  if (aiResult) {
    const pickIdx = (aiResult.pick || 1) - 1;
    if (pickIdx >= 0 && pickIdx < valueBets.length) {
      winnerId = valueBets[pickIdx].id;
      reasoning = aiResult.reasoning || '';
    }
  }

  if (!reasoning) {
    // Final fallback: highest EV
    valueBets.sort((a: any, b: any) => Number(b.expected_value) - Number(a.expected_value));
    winnerId = valueBets[0].id;
    const fb = valueBets[0];
    const tipL = fb.tip === '1' ? 'Home Win' : fb.tip === '2' ? 'Away Win' : 'Draw';
    reasoning = `${tipL} at ${(Number(fb.confidence) * 100).toFixed(0)}% confidence. EV: ${Number(fb.expected_value) > 0 ? '+' : ''}${(Number(fb.expected_value) * 100).toFixed(1)}%. Top EV pick of ${valueBets.length} value bets.`;
    logger.warn('POTD: Both AI providers failed, using highest EV fallback');
  }

  // Score all candidates by EV for ranking
  const scored = valueBets.map((vb: any) => ({
    ...vb,
    potdScore: Number(vb.expected_value),
  }));
  scored.sort((a: any, b: any) => b.potdScore - a.potdScore);

  for (const s of scored) {
    const isPotd = s.id === winnerId;
    await query(
      'UPDATE predictions SET potd_rank_score=$1, is_pick_of_day=$2, reasoning=$3 WHERE id=$4',
      [s.potdScore, isPotd, isPotd ? reasoning : '', s.id]
    );
  }

  const winner = valueBets.find((vb: any) => vb.id === winnerId);
  logger.info(`Pick of the Day for ${date}: id=${winnerId}`);
  return winner;
}
