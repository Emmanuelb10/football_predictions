import axios from 'axios';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import logger from '../config/logger';
import type { ScrapedFixture } from './fixtureScraper';

function getZulubetUrl(date: string): string {
  const d = dayjs(date);
  return `https://www.zulubet.com/tips-${d.format('DD-MM-YYYY')}.html`;
}

function parseProb(text: string): number {
  const m = text.match(/(\d+)/);
  return m ? parseInt(m[1]) / 100 : 0;
}

function parseOdds(text: string): number {
  const m = text.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : 0;
}

export async function scrapeZulubet(date: string): Promise<ScrapedFixture[]> {
  try {
    const url = getZulubetUrl(date);
    logger.info(`Scraping ${url} for ${date}`);

    const { data: html } = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const $ = cheerio.load(html);
    const fixtures: ScrapedFixture[] = [];

    $('tr.main_table').each((_i, row) => {
      try {
        const cells = $(row).find('td');
        if (cells.length < 9) return;

        // Cell 0: Kickoff time — text like "17-03, 22:00"
        const timeText = $(cells[0]).text().trim();
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
        const kickoff = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '';

        // Cell 1: League (from img title) + teams (split by " - ")
        const teamsCell = $(cells[1]);
        const league = teamsCell.find('img').attr('title') || 'Unknown';
        const teamsText = teamsCell.text().trim();
        const teamParts = teamsText.split(/\s+-\s+/);
        if (teamParts.length < 2) return;
        const homeTeam = teamParts[0].trim().toUpperCase();
        const awayTeam = teamParts.slice(1).join(' - ').trim().toUpperCase();
        if (!homeTeam || !awayTeam) return;

        // Cells 2-4: Probabilities ("1: 36%", "X: 35%", "2: 29%")
        const homeWinProb = parseProb($(cells[2]).text());
        const drawProb = parseProb($(cells[3]).text());
        const awayWinProb = parseProb($(cells[4]).text());

        // Cell 5: Tip ("1", "X", "2", "1X", "X2", "12")
        let tip = $(cells[5]).text().trim();
        if (tip.length > 1) tip = tip[0];
        if (!['1', 'X', '2'].includes(tip)) {
          tip = homeWinProb >= drawProb && homeWinProb >= awayWinProb ? '1' :
                drawProb >= awayWinProb ? 'X' : '2';
        }

        // Cells 6-8: Odds ("1: 1.71", "X: 3.34", "2: 5.29")
        const homeOdds = parseOdds($(cells[6]).text());
        const drawOdds = parseOdds($(cells[7]).text());
        const awayOdds = parseOdds($(cells[8]).text());

        // Cell 9+: Score for past matches ("2:1")
        let homeScore: number | undefined;
        let awayScore: number | undefined;
        let status: ScrapedFixture['status'] = 'scheduled';
        if (cells.length > 9) {
          const scoreText = $(cells[9]).text().trim();
          const scoreParts = scoreText.match(/(\d+)\s*:\s*(\d+)/);
          if (scoreParts) {
            homeScore = parseInt(scoreParts[1]);
            awayScore = parseInt(scoreParts[2]);
            status = 'finished';
          }
        }

        fixtures.push({
          homeTeam,
          awayTeam,
          league,
          country: 'Unknown',
          kickoff,
          status,
          homeScore,
          awayScore,
          homeWinProb,
          drawProb,
          awayWinProb,
          tip,
          homeOdds: homeOdds || undefined,
          drawOdds: drawOdds || undefined,
          awayOdds: awayOdds || undefined,
        });
      } catch {
        // Skip unparseable rows
      }
    });

    // Deduplicate by home-away key
    const seen = new Set<string>();
    const unique = fixtures.filter(f => {
      const key = `${f.homeTeam}-${f.awayTeam}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info(`zulubet.com: ${unique.length} fixtures scraped`);
    return unique;
  } catch (error: any) {
    logger.error(`zulubet.com scrape failed: ${error.message}`);
    return [];
  }
}
