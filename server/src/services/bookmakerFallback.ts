import logger from '../config/logger';
import { teamsMatch, teamsStrongMatch } from './livescoreFetcher';

export interface BookmakerMatch {
  homeTeam: string;
  awayTeam: string;
  league?: string;
  kickoff?: string;
  status?: string;
  homeScore?: number;
  awayScore?: number;
  homeOdds?: number;
  drawOdds?: number;
  awayOdds?: number;
}

let puppeteer: any = null;
let StealthPlugin: any = null;

try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch {
  logger.warn('Puppeteer not available. 1xBet fallback verification disabled.');
}

function normalizeWords(name: string): string[] {
  return name.toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(FC|CF|SC|SK|FK|AC|AS|SS|CD|UD|RC|US|SD|CA|SE|CE|AD|CLUB|DE|DEL|LA|EL|THE)\b/g, '')
    .replace(/\b(DV|VINA|VIÑA|MAR)\b/g, '')
    .replace(/\d+/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 4);
}

function bookmakerTeamMatches(dbName: string, bookmakerName: string): boolean {
  if (teamsMatch(dbName, bookmakerName)) return true;

  const dbWords = normalizeWords(dbName);
  const bookmakerWords = normalizeWords(bookmakerName);
  if (dbWords.length === 0 || bookmakerWords.length === 0) return false;

  return dbWords.some(a => bookmakerWords.some(b => a === b || a.includes(b) || b.includes(a)));
}

export function selectBookmakerFixtureForMatch(
  home: string,
  away: string,
  fixtures: BookmakerMatch[],
): BookmakerMatch | null {
  return fixtures.find(f =>
    bookmakerTeamMatches(home, f.homeTeam) &&
    bookmakerTeamMatches(away, f.awayTeam)
  ) ?? null;
}

export function selectBookmakerResultForMatch(
  home: string,
  away: string,
  results: BookmakerMatch[],
): BookmakerMatch | null {
  return results.find(r =>
    r.homeScore != null &&
    r.awayScore != null &&
    ['finished', 'ft', 'full time'].includes((r.status || '').toLowerCase()) &&
    teamsStrongMatch(home, r.homeTeam) &&
    teamsStrongMatch(away, r.awayTeam)
  ) ?? null;
}

export async function fetch1xBetMatches(_date: string): Promise<BookmakerMatch[]> {
  // The production image deliberately skips Puppeteer's browser download.
  // Avoid launching a lookup that cannot succeed (and can hold up fixture
  // ingestion) unless a browser has explicitly been supplied by the host.
  if (!puppeteer || !process.env.PUPPETEER_EXECUTABLE_PATH) return [];

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'shell',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      timeout: 30000,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    await page.goto('https://1xbet.com/en/line/football', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await page.waitForSelector('[class*="sport-event"], [class*="c-events__item"]', { timeout: 15000 }).catch(() => {
      logger.warn('Could not find match elements on 1xBet fallback page');
    });

    const matches: BookmakerMatch[] = await page.evaluate(() => {
      const events: BookmakerMatch[] = [];
      const doc = (globalThis as any).document;
      const eventElements = doc.querySelectorAll('[class*="sport-event"], [class*="c-events__item"]');

      eventElements.forEach((el: any) => {
        try {
          const teams = el.querySelectorAll('[class*="team-name"], [class*="c-events-scoreboard__team"]');
          const odds = el.querySelectorAll('[class*="coefficient"], [class*="c-bets__inner"]');
          const text = el.textContent || '';
          const score = text.match(/\b(\d+)\s*[-:]\s*(\d+)\b/);
          const finished = /\b(FT|Full Time|Finished)\b/i.test(text);

          if (teams.length >= 2) {
            events.push({
              homeTeam: teams[0]?.textContent?.trim() || '',
              awayTeam: teams[1]?.textContent?.trim() || '',
              homeOdds: parseFloat(odds[0]?.textContent?.trim() || '0') || undefined,
              drawOdds: parseFloat(odds[1]?.textContent?.trim() || '0') || undefined,
              awayOdds: parseFloat(odds[2]?.textContent?.trim() || '0') || undefined,
              homeScore: finished && score ? parseInt(score[1]) : undefined,
              awayScore: finished && score ? parseInt(score[2]) : undefined,
              status: finished ? 'finished' : 'scheduled',
            });
          }
        } catch {}
      });

      return events;
    });

    logger.info(`1xBet fallback: ${matches.length} football event(s) scraped`);
    return matches.filter(m => m.homeTeam && m.awayTeam);
  } catch (error: any) {
    logger.warn(`1xBet fallback fetch failed: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
