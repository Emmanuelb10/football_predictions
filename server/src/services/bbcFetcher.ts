import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import logger from '../config/logger';
import type { LivescoreMatch } from './livescoreFetcher';

const bbcAgent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 3 });

/**
 * Extract completed fixtures from the public BBC Sport daily football board.
 * BBC render this as HTML (rather than a supported public JSON API), so keep
 * the parser deliberately tied to the accessible fixture-row markup.
 */
export function parseBbcResults(html: string): LivescoreMatch[] {
  const $ = cheerio.load(html);
  const matches: LivescoreMatch[] = [];

  $('li[data-tipo-topic-id]').each((_index, row) => {
    const fixture = $(row);
    const teams = fixture.find('[class*="TeamNameWrapper"]')
      // BBC renders mobile, desktop, and screen-reader copies of each name.
      // The screen-reader value is the canonical full club name.
      .map((_teamIndex, item) => $(item).find('.visually-hidden').first().text().replace(/\s+/g, ' ').trim() || $(item).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter((name, index, values) => name && values.indexOf(name) === index);

    const text = fixture.text().replace(/\s+/g, ' ').trim();
    const summary = text.match(/(.+?)\s+versus\s+(.+?)\s+(?:kick off|full time)/i);
    const homeTeam = teams[0] || summary?.[1]?.trim();
    const awayTeam = teams[1] || summary?.[2]?.trim();
    if (!homeTeam || !awayTeam) return;

    // BBC's score spans have Score in their class name.  Do not infer scores
    // from arbitrary numbers in the row (such as kick-off time or match IDs).
    const scoreRoot = fixture.find('[data-testid="score"]').first();
    const scoreValues = scoreRoot.length
      ? scoreRoot.children('div').map((_scoreIndex, item) => $(item).text().trim()).get()
      : fixture.find('[class*="Score"]').filter((_scoreIndex, item) => $(item).children().length === 0)
        .map((_scoreIndex, item) => $(item).text().trim()).get();
    const scores = scoreValues
      .filter(value => /^\d{1,3}$/.test(value))
      .slice(0, 2)
      .map(value => Number.parseInt(value, 10));

    const finished = /\b(full time|ft|after extra time|after penalties)\b/i.test(text);
    if (!finished || scores.length !== 2) return;

    matches.push({
      homeTeam,
      awayTeam,
      homeScore: scores[0],
      awayScore: scores[1],
      league: fixture.closest('section').find('h2, h3').first().text().trim() || 'BBC Sport',
      status: 'FT',
      kickoff: '',
    });
  });

  return matches;
}

/** Fetch final scores from BBC Sport's daily football scores page. */
export async function fetchBbcResults(date: string): Promise<LivescoreMatch[]> {
  try {
    const url = `https://www.bbc.com/sport/football/scores-fixtures/${encodeURIComponent(date)}`;
    const { data } = await axios.get<string>(url, {
      proxy: false,
      timeout: 15000,
      httpsAgent: bbcAgent,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });
    const matches = parseBbcResults(data);
    logger.info(`BBC Sport: ${matches.length} finished matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.warn(`BBC Sport fetch failed: ${error.message}`);
    return [];
  }
}
