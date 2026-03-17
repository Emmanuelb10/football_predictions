import axios from 'axios';
import logger from '../config/logger';
import { env } from '../config/env';

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
 * Scrape fixtures from prosoccer.gr using Claude to parse the page content.
 */
export async function scrapeFixtures(date: string): Promise<ScrapedFixture[]> {
  try {
    // Fetch the prosoccer.gr page
    const url = 'https://www.prosoccer.gr/en/football/predictions';
    const { data: html } = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    // Strip scripts/styles, keep text content
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Use Claude to extract structured match data from the page text
    const { data: response } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `Extract ALL football match predictions from this prosoccer.gr page text. The data contains rows with: LEAGUE_CODE | TIME | TEAM1 - TEAM2 | probability1% | probabilityX% | probability2% | tip | odds1 | oddsX | odds2

Page text:
${text.substring(0, 30000)}

Return ONLY a JSON array with every match:
[{"league":"EN1","time":"19:45","home":"BOLTON","away":"DONCASTER","homeProb":77,"drawProb":19,"awayProb":4,"tip":"1","homeOdds":1.60,"drawOdds":3.95,"awayOdds":4.50}]

Rules:
- Include EVERY match from the page, do not skip any
- tip: "1" for home, "X" for draw, "2" for away. If tip shows "a1" or just a number, map it: a1->1, aX->X, a2->2, a1X->1, a21->2, a12->1, a2X->2, aX1->X
- Probabilities are integers (percentages)
- Odds are decimal numbers`
        }],
      },
      {
        headers: {
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const aiText = response.content?.[0]?.text;
    if (!aiText) {
      logger.error('Claude returned empty response for prosoccer parsing');
      return [];
    }

    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.error('No JSON array in Claude prosoccer response');
      return [];
    }

    const rawMatches: any[] = JSON.parse(jsonMatch[0]);
    const fixtures: ScrapedFixture[] = rawMatches.map(m => {
      const leagueInfo = LEAGUE_CODE_MAP[m.league] || { name: m.league, country: 'Unknown' };

      // Normalize tip
      let tip = String(m.tip || '').replace(/^a/, '');
      if (tip.length > 1) tip = tip[0]; // Take first char for compound tips like "12", "1X"
      if (!['1', 'X', '2'].includes(tip)) {
        // Determine from probabilities
        const h = m.homeProb || 0, d = m.drawProb || 0, a = m.awayProb || 0;
        tip = h >= d && h >= a ? '1' : d >= a ? 'X' : '2';
      }

      return {
        homeTeam: m.home,
        awayTeam: m.away,
        league: leagueInfo.name,
        country: leagueInfo.country,
        kickoff: m.time || '15:00',
        status: 'scheduled' as const,
        homeWinProb: (m.homeProb || 0) / 100,
        drawProb: (m.drawProb || 0) / 100,
        awayWinProb: (m.awayProb || 0) / 100,
        tip,
        homeOdds: m.homeOdds || undefined,
        drawOdds: m.drawOdds || undefined,
        awayOdds: m.awayOdds || undefined,
      };
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

export async function scrapeResults(date: string): Promise<ScrapedFixture[]> {
  const fixtures = await scrapeFixtures(date);
  return fixtures.filter(f => f.status === 'finished' && f.homeScore != null);
}
