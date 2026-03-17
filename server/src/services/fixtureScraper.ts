import axios from 'axios';
import logger from '../config/logger';

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

// TheSportsDB league IDs and their expected strLeague values
const TSDB_LEAGUES = [
  { id: 4328, name: 'English Premier League', country: 'England', ourName: 'Premier League' },
  { id: 4335, name: 'Spanish La Liga', country: 'Spain', ourName: 'La Liga' },
  { id: 4332, name: 'Italian Serie A', country: 'Italy', ourName: 'Serie A' },
  { id: 4331, name: 'German Bundesliga', country: 'Germany', ourName: 'Bundesliga' },
  { id: 4334, name: 'French Ligue 1', country: 'France', ourName: 'Ligue 1' },
  { id: 4344, name: 'Portuguese Primeira Liga', country: 'Portugal', ourName: 'Primeira Liga' },
  { id: 4337, name: 'Dutch Eredivisie', country: 'Netherlands', ourName: 'Eredivisie' },
  { id: 4480, name: 'UEFA Champions League', country: 'World', ourName: 'Champions League' },
  { id: 4481, name: 'UEFA Europa League', country: 'World', ourName: 'Europa League' },
];

// Validate that an event actually belongs to the expected league
function isValidLeagueEvent(evt: any, expectedLeague: typeof TSDB_LEAGUES[0]): boolean {
  const evtLeague = (evt.strLeague || '').toLowerCase();
  const expected = expectedLeague.name.toLowerCase();
  const ourName = expectedLeague.ourName.toLowerCase();
  // The event's strLeague must contain the expected league name
  return evtLeague.includes(ourName) || evtLeague.includes(expected) ||
         expected.includes(evtLeague) || ourName.includes(evtLeague);
}

/**
 * Fetch fixtures for a specific date from TheSportsDB.
 */
export async function scrapeFixtures(date: string): Promise<ScrapedFixture[]> {
  const allFixtures: ScrapedFixture[] = [];

  const fetches = TSDB_LEAGUES.map(async (league) => {
    try {
      const endpoints = [
        `https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${league.id}`,
        `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${league.id}`,
      ];

      for (const url of endpoints) {
        try {
          const { data } = await axios.get(url, { timeout: 10000 });
          const events = data.events || [];

          for (const evt of events) {
            if (evt.dateEvent !== date) continue;
            if (evt.strSport !== 'Soccer') continue;
            // Validate the event actually belongs to this league
            if (!isValidLeagueEvent(evt, league)) continue;

            const time = evt.strTime?.substring(0, 5) || '15:00';
            const status: ScrapedFixture['status'] =
              evt.strStatus === 'Match Finished' ? 'finished' :
              evt.strStatus === 'Not Started' ? 'scheduled' :
              evt.strStatus?.includes('Postponed') ? 'postponed' : 'scheduled';

            allFixtures.push({
              homeTeam: evt.strHomeTeam,
              awayTeam: evt.strAwayTeam,
              league: league.ourName,
              country: league.country,
              kickoff: time,
              status,
              homeScore: evt.intHomeScore != null ? Number(evt.intHomeScore) : undefined,
              awayScore: evt.intAwayScore != null ? Number(evt.intAwayScore) : undefined,
            });
          }
        } catch {}
      }
    } catch (error: any) {
      logger.warn(`TheSportsDB fetch failed for ${league.ourName}: ${error.message}`);
    }
  });

  await Promise.all(fetches);

  // Deduplicate
  const seen = new Set<string>();
  const unique = allFixtures.filter(f => {
    const key = `${f.homeTeam}-${f.awayTeam}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logger.info(`Scraped ${unique.length} fixtures for ${date} from TheSportsDB`);
  return unique;
}

export async function scrapeResults(date: string): Promise<ScrapedFixture[]> {
  const fixtures = await scrapeFixtures(date);
  return fixtures.filter(f => f.status === 'finished' && f.homeScore != null);
}
