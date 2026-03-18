import logger from '../config/logger';
import * as OddsModel from '../models/OddsHistory';
import { query } from '../config/database';

// Puppeteer is an optional dependency - the system works without it
let puppeteer: any = null;
let StealthPlugin: any = null;

try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch {
  logger.warn('Puppeteer not available. 1xBet scraping disabled. Using prosoccer.gr odds only.');
}

/**
 * Scrape 1xBet odds for today's matches.
 * Falls back gracefully if Puppeteer is not installed.
 */
export async function scrapeOdds(date: string): Promise<number> {
  if (!puppeteer) {
    logger.info('Puppeteer not available, skipping 1xBet scrape');
    return 0;
  }

  let browser = null;
  let scraped = 0;

  try {
    browser = await puppeteer.launch({
      headless: 'shell',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000,
    });

    const page = await browser.newPage();

    // Set realistic viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Navigate to 1xBet football section
    await page.goto('https://1xbet.com/en/line/football', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for odds to render
    await page.waitForSelector('[class*="sport-event"]', { timeout: 15000 }).catch(() => {
      logger.warn('Could not find match elements on 1xBet');
    });

    // Random delay to mimic human behavior
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

    // Extract match data from the page (runs in browser context)
    const matchData: Array<{ home: string; away: string; homeOdds: number; drawOdds: number; awayOdds: number }> =
      await page.evaluate(() => {
      const events: any[] = [];
      /* eslint-disable no-undef */
      const doc = (globalThis as any).document;
      const eventElements = doc.querySelectorAll('[class*="sport-event"], [class*="c-events__item"]');

      eventElements.forEach((el: any) => {
        try {
          const teams = el.querySelectorAll('[class*="team-name"], [class*="c-events-scoreboard__team"]');
          const odds = el.querySelectorAll('[class*="coefficient"], [class*="c-bets__inner"]');

          if (teams.length >= 2 && odds.length >= 3) {
            events.push({
              home: teams[0]?.textContent?.trim() || '',
              away: teams[1]?.textContent?.trim() || '',
              homeOdds: parseFloat(odds[0]?.textContent?.trim() || '0'),
              drawOdds: parseFloat(odds[1]?.textContent?.trim() || '0'),
              awayOdds: parseFloat(odds[2]?.textContent?.trim() || '0'),
            });
          }
        } catch {}
      });

      return events;
    });

    logger.info(`Scraped ${matchData.length} matches from 1xBet`);

    // Match scraped data to our database matches using fuzzy matching
    const matchRes = await query(
      `SELECT m.id, ht.name as home_name, at2.name as away_name
       FROM matches m JOIN teams ht ON m.home_team_id = ht.id JOIN teams at2 ON m.away_team_id = at2.id
       WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
      [date]
    );
    const todayMatches = matchRes.rows;

    for (const scrapedMatch of matchData) {
      if (!scrapedMatch.homeOdds || !scrapedMatch.drawOdds || !scrapedMatch.awayOdds) continue;

      // Simple fuzzy match: check if team names contain each other
      const dbMatch = todayMatches.find((m: any) =>
        (m.home_name.toLowerCase().includes(scrapedMatch.home.toLowerCase()) ||
         scrapedMatch.home.toLowerCase().includes(m.home_name.toLowerCase())) &&
        (m.away_name.toLowerCase().includes(scrapedMatch.away.toLowerCase()) ||
         scrapedMatch.away.toLowerCase().includes(m.away_name.toLowerCase()))
      );

      if (dbMatch) {
        await OddsModel.insert({
          match_id: dbMatch.id,
          bookmaker: '1xbet',
          market: '1x2',
          home_odds: scrapedMatch.homeOdds,
          draw_odds: scrapedMatch.drawOdds,
          away_odds: scrapedMatch.awayOdds,
        });
        scraped++;
      }
    }

    logger.info(`Matched and stored odds for ${scraped} matches`);
  } catch (error: any) {
    logger.error(`1xBet scraper failed: ${error.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return scraped;
}
