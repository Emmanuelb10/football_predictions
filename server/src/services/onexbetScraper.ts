import axios from 'axios';
import logger from '../config/logger';
import { env } from '../config/env';
import type { ScrapedFixture } from './fixtureScraper';

/**
 * Scrape 1xBet.co.ke football matches.
 * Fetches the line page, strips HTML, and uses Claude to extract match data
 * (same proven approach as prosoccer.gr).
 */
export async function scrape1xbet(date: string): Promise<ScrapedFixture[]> {
  try {
    logger.info(`Scraping 1xbet.co.ke for ${date}`);

    const { data: html } = await axios.get('https://1xbet.co.ke/line/football/', {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Strip scripts/styles, extract text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (text.length < 200) {
      logger.warn('1xbet: Page text too short, likely blocked or empty');
      return [];
    }

    // Use Claude to extract match data from 1xBet page text
    const { data: response } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `Extract ALL football matches from this 1xBet betting page for date ${date}. The page lists upcoming matches with teams, leagues, and 1X2 odds.

Page text (first 25000 chars):
${text.substring(0, 25000)}

Return ONLY a JSON array of matches for ${date}:
[{"home":"Barcelona","away":"Newcastle","league":"Champions League","time":"22:00","homeOdds":1.55,"drawOdds":4.20,"awayOdds":5.50}]

Rules:
- Only include football matches scheduled for ${date}
- Include team names exactly as shown
- Extract 1X2 odds (home win, draw, away win) as decimal numbers
- Include league/competition name
- Include kickoff time in HH:MM format (East Africa Time / UTC+3)
- If no matches found for ${date}, return an empty array []`
        }],
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

    const aiText = response.content?.[0]?.text;
    if (!aiText) {
      logger.warn('1xbet: Claude returned empty response');
      return [];
    }

    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.info('1xbet: No JSON array in Claude response (likely no matches for date)');
      return [];
    }

    const rawMatches: any[] = JSON.parse(jsonMatch[0]);
    const fixtures: ScrapedFixture[] = rawMatches.map(m => {
      const homeOdds = m.homeOdds || 0;
      const drawOdds = m.drawOdds || 0;
      const awayOdds = m.awayOdds || 0;

      // Convert odds to implied probabilities
      const total = (homeOdds ? 1/homeOdds : 0) + (drawOdds ? 1/drawOdds : 0) + (awayOdds ? 1/awayOdds : 0);
      const homeProb = total > 0 && homeOdds ? (1/homeOdds) / total : 0;
      const drawProb = total > 0 && drawOdds ? (1/drawOdds) / total : 0;
      const awayProb = total > 0 && awayOdds ? (1/awayOdds) / total : 0;

      const tip = homeProb >= drawProb && homeProb >= awayProb ? '1' :
                  drawProb >= awayProb ? 'X' : '2';

      return {
        homeTeam: (m.home || '').toUpperCase(),
        awayTeam: (m.away || '').toUpperCase(),
        league: m.league || 'Unknown',
        country: 'Unknown',
        kickoff: m.time || '15:00',
        status: 'scheduled' as const,
        homeWinProb: +homeProb.toFixed(4),
        drawProb: +drawProb.toFixed(4),
        awayWinProb: +awayProb.toFixed(4),
        tip,
        homeOdds: homeOdds || undefined,
        drawOdds: drawOdds || undefined,
        awayOdds: awayOdds || undefined,
      };
    });

    // Deduplicate
    const seen = new Set<string>();
    const unique = fixtures.filter(f => {
      if (!f.homeTeam || !f.awayTeam) return false;
      const key = `${f.homeTeam}-${f.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`1xbet.co.ke: ${unique.length} fixtures extracted for ${date}`);
    return unique;
  } catch (error: any) {
    logger.error(`1xbet.co.ke scrape failed: ${error.message}`);
    return [];
  }
}
