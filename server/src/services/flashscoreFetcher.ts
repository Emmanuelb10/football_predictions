import axios from 'axios';
import dayjs from 'dayjs';
import logger from '../config/logger';
import type { LivescoreMatch } from './livescoreFetcher';

const FLASH_SCORE_SIGNATURE = 'SW9D1eZo';

/**
 * Fetch Flashscore's football event feed for one calendar date.  Flashscore
 * serves the same underlying scores to its Kenya site, while the feed avoids
 * brittle, browser-only rendering selectors.
 */
export async function fetchFlashscoreResults(date: string): Promise<LivescoreMatch[]> {
  try {
    // The public feed takes a date offset, rather than a YYYYMMDD date. The
    // site and this app both display dates in Kenya time.
    const dayOffset = dayjs(date).diff(dayjs().startOf('day'), 'day');
    const { data } = await axios.get<string>(
      `https://www.flashscore.co.ke/x/feed/f_1_${dayOffset}_3_en_1`,
      {
        proxy: false,
        timeout: 15000,
        responseType: 'text',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          'Accept': '*/*',
          'Referer': 'https://www.flashscore.co.ke/',
          'x-fsign': FLASH_SCORE_SIGNATURE,
        },
      },
    );

    const matches = parseFlashscoreResults(data);

    logger.info(`Flashscore Kenya: ${matches.length} finished matches for ${date}`);
    return matches;
  } catch (error: any) {
    // Flashscore occasionally rate-limits public feed requests.  A failed
    // secondary source must never prevent results from the primary feeds.
    logger.warn(`Flashscore Kenya fetch failed: ${error.message}`);
    return [];
  }
}

/** Parse Flashscore's compact feed response. Exported for fixture-based tests. */
export function parseFlashscoreResults(feed: string): LivescoreMatch[] {
  // Event records begin with the home-team field (~AA). The feed includes
  // competition metadata before the first event, which this intentionally
  // discards.
  const events = feed.split('~AA\u00f7').slice(1);
  const matches: LivescoreMatch[] = [];
  for (const rawEvent of events) {
    const event = `~AA\u00f7${rawEvent}`;
    const fields = new Map<string, string>();
    for (const rawField of event.split('\u00ac')) {
      const field = rawField.replace(/^~/, '');
      const delimiter = field.indexOf('\u00f7');
      if (delimiter < 0) continue;
      const key = field.slice(0, delimiter);
      // Some fields are extensions (e.g. ADE). Keep only the exact two-letter
      // event fields so ADE cannot overwrite AD.
      if (/^[A-Z]{2}$/.test(key)) fields.set(key, field.slice(delimiter + 1));
    }

    const status = fields.get('AC');
    const homeScore = Number(fields.get('AG'));
    const awayScore = Number(fields.get('AH'));
    if (status !== '3' || !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;

    // In the current feed AA is the event ID. Team names are AE/AF.
    const homeTeam = fields.get('AE') || '';
    const awayTeam = fields.get('AF') || '';
    if (!homeTeam || !awayTeam) continue;
    matches.push({
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      league: fields.get('CN') || fields.get('CA') || 'Unknown',
      status: 'FT',
      kickoff: '',
    });
  }
  return matches;
}
