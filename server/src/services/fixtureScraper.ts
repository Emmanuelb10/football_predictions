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
  homeWinProb?: number;
  drawProb?: number;
  awayWinProb?: number;
  tip?: string;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
}

// prosoccer.gr league code to our league name mapping
const LEAGUE_CODE_MAP: Record<string, { name: string; country: string }> = {
  'EN0': { name: 'Premier League', country: 'England' },
  'EPL': { name: 'Premier League', country: 'England' },
  'EN1': { name: 'English League One', country: 'England' },
  'EN2': { name: 'English League Two', country: 'England' },
  'ES0': { name: 'La Liga', country: 'Spain' },
  'ES1': { name: 'La Liga', country: 'Spain' },
  'IT0': { name: 'Serie A', country: 'Italy' },
  'IT1': { name: 'Serie A', country: 'Italy' },
  'IT2': { name: 'Serie B', country: 'Italy' },
  'DE0': { name: 'Bundesliga', country: 'Germany' },
  'DE1': { name: 'Bundesliga', country: 'Germany' },
  'FR0': { name: 'Ligue 1', country: 'France' },
  'FR1': { name: 'Ligue 1', country: 'France' },
  'PT1': { name: 'Primeira Liga', country: 'Portugal' },
  'NL1': { name: 'Eredivisie', country: 'Netherlands' },
  'ECL': { name: 'Champions League', country: 'Europe' },
  'EL1': { name: 'Europa League', country: 'Europe' },
  'ECO': { name: 'Conference League', country: 'Europe' },
  'TR1': { name: 'Super Lig', country: 'Turkey' },
  'SC0': { name: 'Scottish Premiership', country: 'Scotland' },
  'GR1': { name: 'Super League', country: 'Greece' },
  'BE1': { name: 'Pro League', country: 'Belgium' },
  'AR1': { name: 'Liga Profesional', country: 'Argentina' },
  'BR1': { name: 'Serie A', country: 'Brazil' },
};

/**
 * Scrape fixtures + predictions + odds from prosoccer.gr
 */
export async function scrapeFixtures(date: string): Promise<ScrapedFixture[]> {
  // Try prosoccer.gr first, then fallbacks
  let fixtures = await scrapeFromProsoccer(date);
  if (fixtures.length > 0) return fixtures;

  logger.warn('prosoccer.gr returned no data, no fallback available');
  return [];
}

async function scrapeFromProsoccer(date: string): Promise<ScrapedFixture[]> {
  try {
    // prosoccer.gr shows today's predictions at /en/football/predictions
    // For specific dates: /en/football/predictions/YYYY-MM-DD
    const url = `https://www.prosoccer.gr/en/football/predictions/${date}`;
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const fixtures: ScrapedFixture[] = [];

    // Parse the HTML table rows using regex (no DOM parser needed)
    // prosoccer.gr uses a table with rows containing: league, time, teams, probs, tip, odds
    // Match pattern: league code | time | TEAM1 - TEAM2 | prob1 | probX | prob2 | tip | odds1 | oddsX | odds2

    // Extract table rows - look for match data patterns
    const rowPattern = /class="[^"]*pred[^"]*"[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowPattern) || [];

    // Also try a simpler approach: extract all text content between tags
    // The page content has patterns like: EN1|19:45|BOLTON - DONCASTER|77%|19%|4%|...
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '|')
      .replace(/\|\s*\|/g, '|')
      .replace(/\|{2,}/g, '|');

    // Find match patterns in the text: LeagueCode | Time | TEAM - TEAM | prob% | prob% | prob%
    const lines = textContent.split('\n').join('|').split('|').map((s: string) => s.trim()).filter(Boolean);

    let i = 0;
    while (i < lines.length - 8) {
      // Look for a league code pattern (2-3 uppercase letters + digit)
      const leagueMatch = lines[i].match(/^([A-Z]{2,3}\d?)$/);
      if (leagueMatch) {
        const leagueCode = leagueMatch[1];
        const leagueInfo = LEAGUE_CODE_MAP[leagueCode];

        // Next should be time (HH:MM format)
        const timeMatch = lines[i + 1]?.match(/^(\d{1,2}:\d{2})$/);
        if (timeMatch) {
          const kickoff = timeMatch[1];

          // Next should be teams (TEAM - TEAM or TEAM vs TEAM)
          const teamsStr = lines[i + 2];
          const teamsParts = teamsStr?.split(/\s*[-–vs]+\s*/);

          if (teamsParts && teamsParts.length >= 2) {
            const homeTeam = teamsParts[0].trim();
            const awayTeam = teamsParts[teamsParts.length - 1].trim();

            if (homeTeam && awayTeam && homeTeam.length > 1 && awayTeam.length > 1) {
              // Look ahead for percentages and odds
              let homeProb = 0, drawProb = 0, awayProb = 0;
              let homeOdds = 0, drawOdds = 0, awayOdds = 0;
              let tip = '';

              // Scan next ~10 tokens for probabilities (XX%) and odds (X.XX)
              const lookahead = lines.slice(i + 3, i + 15).join(' ');

              const probMatches = lookahead.match(/(\d{1,3})%/g);
              if (probMatches && probMatches.length >= 3) {
                homeProb = parseInt(probMatches[0]) / 100;
                drawProb = parseInt(probMatches[1]) / 100;
                awayProb = parseInt(probMatches[2]) / 100;
              }

              const oddsMatches = lookahead.match(/\b(\d+\.\d{2})\b/g);
              if (oddsMatches && oddsMatches.length >= 3) {
                homeOdds = parseFloat(oddsMatches[0]);
                drawOdds = parseFloat(oddsMatches[1]);
                awayOdds = parseFloat(oddsMatches[2]);
              }

              // Determine tip from probabilities
              if (homeProb >= drawProb && homeProb >= awayProb) tip = '1';
              else if (drawProb >= homeProb && drawProb >= awayProb) tip = 'X';
              else tip = '2';

              fixtures.push({
                homeTeam,
                awayTeam,
                league: leagueInfo?.name || leagueCode,
                country: leagueInfo?.country || 'Unknown',
                kickoff,
                status: 'scheduled',
                homeWinProb: homeProb || undefined,
                drawProb: drawProb || undefined,
                awayWinProb: awayProb || undefined,
                tip: homeProb ? tip : undefined,
                homeOdds: homeOdds || undefined,
                drawOdds: drawOdds || undefined,
                awayOdds: awayOdds || undefined,
              });

              i += 3;
              continue;
            }
          }
        }
      }
      i++;
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = fixtures.filter(f => {
      const key = `${f.homeTeam}-${f.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`prosoccer.gr: scraped ${unique.length} fixtures for ${date}`);
    return unique;
  } catch (error: any) {
    logger.error(`prosoccer.gr scrape failed: ${error.message}`);
    return [];
  }
}

export async function scrapeResults(date: string): Promise<ScrapedFixture[]> {
  const fixtures = await scrapeFixtures(date);
  return fixtures.filter(f => f.status === 'finished' && f.homeScore != null);
}
