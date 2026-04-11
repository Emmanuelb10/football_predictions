import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../config/logger';
import { fetchScheduledFixtures } from './livescoreFetcher';
import { teamsMatch } from './livescoreFetcher';
import { scrapeZulubet } from './zulubetScraper';

export interface ScrapedFixture {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed';
  homeScore?: number;
  awayScore?: number;
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  tip?: string;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
}

const LEAGUE_CODE_MAP: Record<string, { name: string; country: string }> = {
  'EN0': { name: 'Premier League', country: 'England' },
  'EN1': { name: 'English League One', country: 'England' },
  'EN2': { name: 'English League Two', country: 'England' },
  'ENB': { name: 'English National League', country: 'England' },
  'ENC': { name: 'English Championship', country: 'England' },
  'ES0': { name: 'La Liga', country: 'Spain' },
  'ES1': { name: 'La Liga 2', country: 'Spain' },
  'IT0': { name: 'Serie A', country: 'Italy' },
  'IT1': { name: 'Serie A', country: 'Italy' },
  'IT2': { name: 'Serie B', country: 'Italy' },
  'DE0': { name: 'Bundesliga', country: 'Germany' },
  'DE1': { name: 'Bundesliga', country: 'Germany' },
  'FR0': { name: 'Ligue 1', country: 'France' },
  'FR1': { name: 'Ligue 1', country: 'France' },
  'PT1': { name: 'Primeira Liga', country: 'Portugal' },
  'NL1': { name: 'Eredivisie', country: 'Netherlands' },
  'NL2': { name: 'Eerste Divisie', country: 'Netherlands' },
  'ECL': { name: 'Champions League', country: 'Europe' },
  'EL1': { name: 'Europa League', country: 'Europe' },
  'ECO': { name: 'Conference League', country: 'Europe' },
  'TR1': { name: 'Super Lig', country: 'Turkey' },
  'SC0': { name: 'Scottish Premiership', country: 'Scotland' },
  'SC2': { name: 'Scottish League One', country: 'Scotland' },
  'SC3': { name: 'Scottish League Two', country: 'Scotland' },
  'GR1': { name: 'Super League', country: 'Greece' },
  'BE1': { name: 'Pro League', country: 'Belgium' },
  'AR1': { name: 'Liga Profesional', country: 'Argentina' },
  'BR1': { name: 'Serie A', country: 'Brazil' },
  'AU1': { name: 'A-League', country: 'Australia' },
  'BG1': { name: 'First League', country: 'Bulgaria' },
  'CH1': { name: 'Super League', country: 'Switzerland' },
  'PL1': { name: 'Ekstraklasa', country: 'Poland' },
  'RUC': { name: 'Russian Cup', country: 'Russia' },
  'KR1': { name: 'K League', country: 'South Korea' },
  'KZ1': { name: 'Premier League', country: 'Kazakhstan' },
  'CO1': { name: 'Liga BetPlay', country: 'Colombia' },
  'ZA1': { name: 'Premier League', country: 'South Africa' },
  'SKC': { name: 'Slovak Cup', country: 'Slovakia' },
};

/**
 * Build prosoccer.gr URL for a specific date.
 */
function getProsoccerUrl(date: string): string {
  const target = new Date(date + 'T12:00:00Z');
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (diffDays === 0) return 'https://www.prosoccer.gr/en/football/predictions';
  if (diffDays === -1) return 'https://www.prosoccer.gr/en/football/predictions/yesterday.html';
  if (diffDays === 1) return 'https://www.prosoccer.gr/en/football/predictions/tomorrow.html';

  const dayName = target.toLocaleDateString('en-US', { weekday: 'long' });
  return `https://www.prosoccer.gr/en/football/predictions/${dayName}.html`;
}

/**
 * Scrape fixtures from prosoccer.gr using cheerio to parse HTML directly.
 */
export async function scrapeFixtures(date: string): Promise<ScrapedFixture[]> {
  try {
    const url = getProsoccerUrl(date);
    logger.info(`Scraping ${url} for ${date}`);
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.prosoccer.gr/',
        'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
      },
    });

    const $ = cheerio.load(html);
    const fixtures: ScrapedFixture[] = [];

    // prosoccer.gr uses table rows with match data:
    // cells: league_code | time | teams | prob1 | probX | prob2 | tip | odds1 | oddsX | odds2 | ...
    $('table tr').each((_i, row) => {
      try {
        const cells = $(row).find('td');
        if (cells.length < 10) return;

        // First cell should be a league code (2-3 uppercase letters + optional digit)
        const leagueCode = $(cells[0]).text().trim();
        if (!leagueCode.match(/^[A-Z]{2,3}\d?$/)) return;

        const time = $(cells[1]).text().trim();
        if (!time.match(/^\d{1,2}:\d{2}$/)) return;

        const teamsText = $(cells[2]).text().trim();
        const teamParts = teamsText.split(/\s*-\s*/);
        if (teamParts.length < 2) return;
        const homeTeam = teamParts[0].trim();
        const awayTeam = teamParts.slice(1).join('-').trim();
        if (!homeTeam || !awayTeam) return;

        const homeProb = parseInt($(cells[3]).text().trim()) || 0;
        const drawProb = parseInt($(cells[4]).text().trim()) || 0;
        const awayProb = parseInt($(cells[5]).text().trim()) || 0;

        // Normalize tip: strip 'a' prefix, take first char for compounds
        let tip = $(cells[6]).text().trim().replace(/^a/, '');
        if (tip.length > 1) tip = tip[0];
        if (!['1', 'X', '2'].includes(tip)) {
          tip = homeProb >= drawProb && homeProb >= awayProb ? '1' : drawProb >= awayProb ? 'X' : '2';
        }

        const homeOdds = parseFloat($(cells[7]).text().trim()) || 0;
        const drawOdds = parseFloat($(cells[8]).text().trim()) || 0;
        const awayOdds = parseFloat($(cells[9]).text().trim()) || 0;

        // Check for score in later cells (past matches)
        let homeScore: number | undefined;
        let awayScore: number | undefined;
        let status: ScrapedFixture['status'] = 'scheduled';
        for (let c = 10; c < cells.length; c++) {
          const cellText = $(cells[c]).text().trim();
          const scoreParts = cellText.match(/^(\d+)\s*[-:]\s*(\d+)$/);
          if (scoreParts) {
            homeScore = parseInt(scoreParts[1]);
            awayScore = parseInt(scoreParts[2]);
            status = 'finished';
            break;
          }
        }

        const leagueInfo = LEAGUE_CODE_MAP[leagueCode] || { name: leagueCode, country: 'Unknown' };

        fixtures.push({
          homeTeam,
          awayTeam,
          league: leagueInfo.name,
          country: leagueInfo.country,
          kickoff: time,
          status,
          homeScore,
          awayScore,
          homeWinProb: homeProb / 100,
          drawProb: drawProb / 100,
          awayWinProb: awayProb / 100,
          tip,
          homeOdds: homeOdds || undefined,
          drawOdds: drawOdds || undefined,
          awayOdds: awayOdds || undefined,
        });
      } catch {
        // Skip unparseable rows
      }
    });

    // Deduplicate
    const seen = new Set<string>();
    const unique = fixtures.filter(f => {
      const key = `${f.homeTeam}-${f.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`prosoccer.gr: ${unique.length} fixtures scraped`);
    return unique;
  } catch (error: any) {
    logger.error(`prosoccer.gr scrape failed: ${error.message}`);
    return [];
  }
}

/**
 * Check if two team names likely refer to the same team.
 */
function teamsMatchFuzzy(a: string, b: string): boolean {
  const na = a.toUpperCase().replace(/^FC\s+|\s+FC$|^SC\s+|\s+SC$/g, '').trim();
  const nb = b.toUpperCase().replace(/^FC\s+|\s+FC$|^SC\s+|\s+SC$/g, '').trim();
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  const wa = na.split(/\s+/).find(w => w.length >= 3);
  const wb = nb.split(/\s+/).find(w => w.length >= 3);
  return !!(wa && wb && wa === wb);
}

/**
 * Fetch fixtures from all sources. Livescore.com API is the primary fixture source.
 * Web scrapers (prosoccer, zulubet) enrich matches with odds and probabilities.
 */
export async function scrapeAllSources(date: string): Promise<ScrapedFixture[]> {
  const [livescoreResult, prosoccerResult, zulubetResult] = await Promise.allSettled([
    fetchScheduledFixtures(date),
    scrapeFixtures(date),
    scrapeZulubet(date),
  ]);

  const livescore = livescoreResult.status === 'fulfilled' ? livescoreResult.value : [];
  const prosoccer = prosoccerResult.status === 'fulfilled' ? prosoccerResult.value : [];
  const zulubet = zulubetResult.status === 'fulfilled' ? zulubetResult.value : [];

  // Build odds lookup from scrapers (prosoccer is highest priority — loaded last)
  const oddsLookup = new Map<string, { odds: ScrapedFixture; source: string }>();
  for (const src of [
    { fixtures: zulubet, name: 'zulubet' },
    { fixtures: prosoccer, name: 'prosoccer' },
  ]) {
    for (const f of src.fixtures) {
      if (f.homeOdds && f.drawOdds && f.awayOdds) {
        oddsLookup.set(f.homeTeam.toUpperCase(), { odds: f, source: src.name });
      }
    }
  }

  // Convert livescore fixtures to ScrapedFixture, enriching with scraped odds/probs
  const merged: ScrapedFixture[] = livescore.map(lm => {
    let odds: ScrapedFixture | undefined;
    for (const [key, val] of oddsLookup) {
      if (teamsMatch(lm.homeTeam, key)) {
        odds = val.odds;
        break;
      }
    }

    return {
      homeTeam: lm.homeTeam,
      awayTeam: lm.awayTeam,
      league: lm.league,
      country: 'Unknown',
      kickoff: lm.kickoff,
      status: (lm.status === '' || lm.status === 'NS') ? 'scheduled' as const : 'live' as const,
      homeScore: lm.homeScore || undefined,
      awayScore: lm.awayScore || undefined,
      homeWinProb: odds?.homeWinProb,
      drawProb: odds?.drawProb,
      awayWinProb: odds?.awayWinProb,
      tip: odds?.tip,
      homeOdds: odds?.homeOdds,
      drawOdds: odds?.drawOdds,
      awayOdds: odds?.awayOdds,
    };
  });

  // Add scraper-only matches not in livescore
  const allScraped = [...prosoccer, ...zulubet];
  let scraperOnly = 0;
  for (const sf of allScraped) {
    if (!merged.some(m => teamsMatchFuzzy(m.homeTeam, sf.homeTeam))) {
      merged.push(sf);
      scraperOnly++;
    }
  }

  logger.info(`All sources: ${merged.length} total (livescore: ${livescore.length}, prosoccer: ${prosoccer.length}, zulubet: ${zulubet.length}, scraper-only: ${scraperOnly})`);
  return merged;
}

export async function scrapeResults(date: string): Promise<ScrapedFixture[]> {
  const fixtures = await scrapeFixtures(date);
  return fixtures.filter(f => f.status === 'finished' && f.homeScore != null);
}
