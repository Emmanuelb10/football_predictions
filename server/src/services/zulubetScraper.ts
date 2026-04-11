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

    // Zulubet table structure (17 cells per data row):
    // [0]  Time ("mf_usertime(...);" prefix + "20-03, 23:30")
    // [1]  League (img title) + teams ("Union Espanola - D. Puerto Montt")
    // [2]  Combined probs min ("1: 65%X: 19%2: 16%")
    // [3]  Home prob ("1: 65%")
    // [4]  Draw prob ("X: 19%")
    // [5]  Away prob ("2: 16%")
    // [6-8] Probs full (desktop only, same values)
    // [9]  Tip ("1", "X", "2", "1X", etc.)
    // [10] Empty
    // [11] Combined odds min ("1: 1.88X: 3.22...")
    // [12] Home odds ("1.88")
    // [13] Draw odds ("3.22")
    // [14] Away odds ("3.81")
    // [15] Score ("2:1") or empty
    // [16] Empty
    $('.main_table tr').each((_i, row) => {
      try {
        const cells = $(row).find('td');
        if (cells.length !== 17) return;

        // Cell 0: Time — extract HH:MM from text like "mf_usertime(...);20-03, 23:30"
        const timeText = $(cells[0]).text().trim();
        const timeMatch = timeText.match(/(\d{1,2}):(\d{2})/);
        if (!timeMatch) return;
        const kickoff = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;

        // Cell 1: League (img title) + teams
        const matchCell = $(cells[1]);
        const league = matchCell.find('img').attr('title') || 'Unknown';
        const teamsText = matchCell.text().trim();
        const teamParts = teamsText.split(/\s*-\s*/);
        if (teamParts.length < 2) return;
        const homeTeam = teamParts[0].trim().toUpperCase();
        const awayTeam = teamParts.slice(1).join(' - ').trim().toUpperCase();
        if (!homeTeam || !awayTeam) return;

        // Cells 3-5: Probabilities ("1: 65%", "X: 19%", "2: 16%")
        const homeWinProb = parseProb($(cells[3]).text());
        const drawProb = parseProb($(cells[4]).text());
        const awayWinProb = parseProb($(cells[5]).text());

        // Cell 9: Tip
        let tip = $(cells[9]).text().trim();
        if (tip.length > 1) tip = tip[0];
        if (!['1', 'X', '2'].includes(tip)) {
          tip = homeWinProb >= drawProb && homeWinProb >= awayWinProb ? '1' :
                drawProb >= awayWinProb ? 'X' : '2';
        }

        // Cells 12-14: Odds (full columns)
        const homeOdds = parseOdds($(cells[12]).text());
        const drawOdds = parseOdds($(cells[13]).text());
        const awayOdds = parseOdds($(cells[14]).text());

        // Cell 15: Score for past matches ("2:1")
        let homeScore: number | undefined;
        let awayScore: number | undefined;
        let status: ScrapedFixture['status'] = 'scheduled';
        const scoreText = $(cells[15]).text().trim();
        const scoreParts = scoreText.match(/^(\d+)\s*:\s*(\d+)$/);
        if (scoreParts) {
          homeScore = parseInt(scoreParts[1]);
          awayScore = parseInt(scoreParts[2]);
          status = 'finished';
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
