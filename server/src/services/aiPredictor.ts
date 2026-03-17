import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export interface AIPrediction {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  tip: string;
  reasoning: string;
  source: 'gemini' | 'claude';
}

interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  homeForm?: string;
  awayForm?: string;
  h2h?: string;
}

function buildPrompt(ctx: MatchContext): string {
  return `You are an expert football (soccer) analyst AI. Analyze this upcoming match and provide win probabilities.

Match: ${ctx.homeTeam} vs ${ctx.awayTeam}
League: ${ctx.league} (${ctx.country})
Kickoff: ${ctx.kickoff}
${ctx.homeForm ? `Home Team Recent Form: ${ctx.homeForm}` : ''}
${ctx.awayForm ? `Away Team Recent Form: ${ctx.awayForm}` : ''}
${ctx.h2h ? `Head-to-Head: ${ctx.h2h}` : ''}

Based on your knowledge of these teams, their current season form, squad strength, home/away advantage, historical performance, and league context, provide your probability assessment.

You MUST respond with ONLY a valid JSON object in this exact format, no other text:
{"home_win_prob": 0.XX, "draw_prob": 0.XX, "away_win_prob": 0.XX, "tip": "1", "reasoning": "Brief 1-2 sentence analysis"}

Rules:
- Probabilities must sum to 1.00 (within rounding)
- "tip" must be "1" (home win), "X" (draw), or "2" (away win) — whichever has the highest probability
- Be realistic: use your knowledge of team quality, form, and league patterns
- Home advantage typically adds 5-10% to the home team's probability
- Consider squad depth, injuries context, and seasonal patterns you know about`;
}

function parseAIResponse(text: string): { homeWinProb: number; drawProb: number; awayWinProb: number; tip: string; reasoning: string } | null {
  try {
    // Extract JSON from the response (handle markdown code blocks too)
    const jsonMatch = text.match(/\{[\s\S]*?"home_win_prob"[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    const homeWinProb = Number(parsed.home_win_prob);
    const drawProb = Number(parsed.draw_prob);
    const awayWinProb = Number(parsed.away_win_prob);
    const tip = String(parsed.tip);
    const reasoning = String(parsed.reasoning || '');

    if (isNaN(homeWinProb) || isNaN(drawProb) || isNaN(awayWinProb)) return null;
    if (!['1', 'X', '2'].includes(tip)) return null;

    // Normalize to sum to 1
    const total = homeWinProb + drawProb + awayWinProb;
    if (total <= 0) return null;

    return {
      homeWinProb: homeWinProb / total,
      drawProb: drawProb / total,
      awayWinProb: awayWinProb / total,
      tip,
      reasoning,
    };
  } catch (error) {
    logger.error(`Failed to parse AI response: ${text.substring(0, 200)}`);
    return null;
  }
}

/**
 * Get prediction from Gemini (primary AI).
 */
async function predictWithGemini(ctx: MatchContext): Promise<AIPrediction | null> {
  if (!env.GEMINI_API_KEY) {
    logger.warn('GEMINI_API_KEY not set, skipping Gemini prediction');
    return null;
  }

  try {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: buildPrompt(ctx) }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
        },
      },
      { timeout: 30000 }
    );

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logger.warn('Gemini returned empty response');
      return null;
    }

    const parsed = parseAIResponse(text);
    if (!parsed) return null;

    logger.info(`Gemini prediction for ${ctx.homeTeam} vs ${ctx.awayTeam}: ${parsed.tip} (${(parsed.homeWinProb * 100).toFixed(1)}/${(parsed.drawProb * 100).toFixed(1)}/${(parsed.awayWinProb * 100).toFixed(1)})`);

    return {
      ...parsed,
      confidence: Math.max(parsed.homeWinProb, parsed.drawProb, parsed.awayWinProb),
      source: 'gemini',
    };
  } catch (error: any) {
    logger.error(`Gemini prediction failed: ${error.message}`);
    return null;
  }
}

/**
 * Get prediction from Claude (fallback AI).
 */
async function predictWithClaude(ctx: MatchContext): Promise<AIPrediction | null> {
  if (!env.CLAUDE_API_KEY) {
    logger.warn('CLAUDE_API_KEY not set, skipping Claude prediction');
    return null;
  }

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [
          { role: 'user', content: buildPrompt(ctx) },
        ],
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

    const text = data.content?.[0]?.text;
    if (!text) {
      logger.warn('Claude returned empty response');
      return null;
    }

    const parsed = parseAIResponse(text);
    if (!parsed) return null;

    logger.info(`Claude prediction for ${ctx.homeTeam} vs ${ctx.awayTeam}: ${parsed.tip} (${(parsed.homeWinProb * 100).toFixed(1)}/${(parsed.drawProb * 100).toFixed(1)}/${(parsed.awayWinProb * 100).toFixed(1)})`);

    return {
      ...parsed,
      confidence: Math.max(parsed.homeWinProb, parsed.drawProb, parsed.awayWinProb),
      source: 'claude',
    };
  } catch (error: any) {
    logger.error(`Claude prediction failed: ${error.message}`);
    return null;
  }
}

/**
 * Get AI prediction: tries Gemini first, falls back to Claude.
 */
export async function getAIPrediction(ctx: MatchContext): Promise<AIPrediction | null> {
  // Try Gemini first (primary)
  const geminiResult = await predictWithGemini(ctx);
  if (geminiResult) return geminiResult;

  // Fallback to Claude
  logger.info(`Falling back to Claude for ${ctx.homeTeam} vs ${ctx.awayTeam}`);
  const claudeResult = await predictWithClaude(ctx);
  if (claudeResult) return claudeResult;

  logger.error(`All AI providers failed for ${ctx.homeTeam} vs ${ctx.awayTeam}`);
  return null;
}
