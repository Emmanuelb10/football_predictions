import axios from 'axios';
import logger from '../config/logger';
import type { LivescoreMatch } from './livescoreFetcher';

interface Scores365Game {
  homeCompetitor?: { name?: string; score?: number };
  awayCompetitor?: { name?: string; score?: number };
  competitionDisplayName?: string;
  statusGroup?: number;
  statusText?: string;
}

/** Parse only explicitly ended games with numeric final scores. */
export function parse365ScoresResults(data: { games?: Scores365Game[] }): LivescoreMatch[] {
  return (data.games || []).flatMap((game) => {
    const homeTeam = game.homeCompetitor?.name?.trim() || '';
    const awayTeam = game.awayCompetitor?.name?.trim() || '';
    const homeScore = game.homeCompetitor?.score;
    const awayScore = game.awayCompetitor?.score;
    // 3 = just ended and 4 = ended in 365Scores' game status model.
    if (![3, 4].includes(game.statusGroup ?? 0) ||
        !homeTeam || !awayTeam ||
        !Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return [];

    return [{
      homeTeam,
      awayTeam,
      homeScore: homeScore as number,
      awayScore: awayScore as number,
      league: game.competitionDisplayName || '365Scores',
      status: 'FT',
      kickoff: '',
    }];
  });
}

/** Fetch football finals from 365Scores' daily structured games feed. */
export async function fetch365ScoresResults(date: string): Promise<LivescoreMatch[]> {
  try {
    const [year, month, day] = date.split('-');
    const dateParam = `${day}/${month}/${year}`;
    const { data } = await axios.get<{ games?: Scores365Game[] }>(
      'https://webws.365scores.com/web/games/',
      {
        proxy: false,
        timeout: 15000,
        params: {
          appTypeId: 5,
          langId: 1,
          timezoneName: 'UTC',
          userCountryId: 1,
          sports: 1,
          startDate: dateParam,
          endDate: dateParam,
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
      },
    );
    const matches = parse365ScoresResults(data);
    logger.info(`365Scores: ${matches.length} finished matches for ${date}`);
    return matches;
  } catch (error: any) {
    logger.warn(`365Scores fetch failed: ${error.message}`);
    return [];
  }
}
