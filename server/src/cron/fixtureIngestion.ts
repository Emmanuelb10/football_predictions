import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import logger from '../config/logger';

dayjs.extend(utc);
dayjs.extend(timezone);
import { query } from '../config/database';
import { fetchLivescores, fetchEspnAllMatches, teamsMatch } from '../services/livescoreFetcher';
import type { LivescoreMatch } from '../services/livescoreFetcher';
import * as fixtureScraper from '../services/fixtureScraper';
import * as predictionEngine from '../services/predictionEngine';
import * as TournamentModel from '../models/Tournament';
import * as TeamModel from '../models/Team';
import * as MatchModel from '../models/Match';
import * as OddsModel from '../models/OddsHistory';

const LEAGUE_MAP: Record<string, { apiId: number; country: string }> = {
  'premier league': { apiId: 39, country: 'England' },
  'english premier league': { apiId: 39, country: 'England' },
  'english league one': { apiId: 39, country: 'England' },
  'english league two': { apiId: 39, country: 'England' },
  'la liga': { apiId: 140, country: 'Spain' },
  'serie a': { apiId: 135, country: 'Italy' },
  'serie b': { apiId: 136, country: 'Italy' },
  'bundesliga': { apiId: 78, country: 'Germany' },
  'ligue 1': { apiId: 61, country: 'France' },
  'primeira liga': { apiId: 94, country: 'Portugal' },
  'liga portugal': { apiId: 94, country: 'Portugal' },
  'eredivisie': { apiId: 88, country: 'Netherlands' },
  'champions league': { apiId: 2, country: 'Europe' },
  'europa league': { apiId: 3, country: 'Europe' },
  'conference league': { apiId: 848, country: 'Europe' },
  'super lig': { apiId: 203, country: 'Turkey' },
  'scottish premiership': { apiId: 179, country: 'Scotland' },
  'super league': { apiId: 197, country: 'Greece' },
  'pro league': { apiId: 144, country: 'Belgium' },
  'liga profesional': { apiId: 128, country: 'Argentina' },
};

function findLeague(name: string): { apiId: number; country: string } | null {
  const lower = name.toLowerCase().trim();
  if (LEAGUE_MAP[lower]) return LEAGUE_MAP[lower];
  for (const [key, val] of Object.entries(LEAGUE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return { apiId: Math.abs(hashString(name)), country: 'Unknown' };
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function ingestFixtures(targetDate?: string) {
  const today = targetDate || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
  logger.info(`Starting fixture ingestion for ${today}`);

  try {
    // Step 1: Scrape fixtures from all sources
    logger.info('Scraping all sources for fixtures...');
    let fixtures = await fixtureScraper.scrapeAllSources(today);

    // Only process matches with 70%+ probability AND tipped odds 1.50-1.99
    // AND opposing side odds >= 5.00 (heavy underdog — the weaker team is priced
    // as a long shot, confirming the market agrees with the high-confidence pick).
    const withPredictions = fixtures.filter(f => {
      if (!f.homeOdds || !f.drawOdds || !f.awayOdds) return false;
      if (!f.homeWinProb || !f.drawProb || !f.awayWinProb) return false;

      const maxProb = Math.max(f.homeWinProb, f.drawProb, f.awayWinProb);
      if (maxProb < 0.70) return false;

      const tip = f.tip || (f.homeWinProb >= f.drawProb && f.homeWinProb >= f.awayWinProb ? '1' :
        f.drawProb >= f.awayWinProb ? 'X' : '2');
      const tipOdds = tip === '1' ? f.homeOdds : tip === '2' ? f.awayOdds : f.drawOdds;
      if (tipOdds < 1.50 || tipOdds > 1.99) return false;

      // Opposing side must be a heavy underdog (>= 5.00). For home/away tips, the
      // opposing side is the other team. For draw tips, both sides must be >= 5.00.
      const opposingOdds = tip === '1' ? f.awayOdds : tip === '2' ? f.homeOdds : Math.min(f.homeOdds, f.awayOdds);
      return opposingOdds >= 5.00;
    });

    logger.info(`${fixtures.length} total fixtures, ${withPredictions.length} qualify (70%+ prob, odds 1.50-1.99, opposing >= 5.00)`);

    if (withPredictions.length === 0) {
      logger.info(`No fixtures with predictions for ${today}`);
      return;
    }

    // Step 2: Verify matches exist on ESPN or livescore for this date (±1 day)
    const prevDate = dayjs(today).subtract(1, 'day').format('YYYY-MM-DD');
    const nextDate = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
    const [espnMain, espnPrev, espnNext, lsMain, lsPrev, lsNext] = await Promise.all([
      fetchEspnAllMatches(today).catch(() => [] as LivescoreMatch[]),
      fetchEspnAllMatches(prevDate).catch(() => [] as LivescoreMatch[]),
      fetchEspnAllMatches(nextDate).catch(() => [] as LivescoreMatch[]),
      fetchLivescores(today),
      fetchLivescores(prevDate),
      fetchLivescores(nextDate),
    ]);
    const verifyPool = [...espnMain, ...espnPrev, ...espnNext, ...lsMain, ...lsPrev, ...lsNext];

    const verified = withPredictions.filter(f => {
      // Require BOTH home AND away team to match — prevents false positives from partial name matches
      const found = verifyPool.some(v =>
        teamsMatch(f.homeTeam, v.homeTeam) && teamsMatch(f.awayTeam, v.awayTeam)
      );
      if (!found) logger.info(`Unverified (not on ESPN/livescore): ${f.homeTeam} vs ${f.awayTeam}`);
      return found;
    });

    logger.info(`${verified.length}/${withPredictions.length} verified on ESPN/livescore`);

    if (verified.length === 0) {
      logger.info(`No verified fixtures for ${today}`);
      return;
    }

    // Step 3: Store verified qualifying fixtures in DB
    let ingested = 0;

    for (const f of verified) {
      const leagueInfo = findLeague(f.league);
      if (!leagueInfo) continue;

      const tournament = await TournamentModel.upsert({
        api_football_id: leagueInfo.apiId,
        name: f.league,
        country: f.country || leagueInfo.country,
        season: 2025,
      });

      const homeTeam = await TeamModel.upsert({
        api_football_id: hashString(f.homeTeam),
        name: f.homeTeam,
        tournament_id: tournament.id,
      });

      const awayTeam = await TeamModel.upsert({
        api_football_id: hashString(f.awayTeam),
        name: f.awayTeam,
        tournament_id: tournament.id,
      });

      const kickoffTime = f.kickoff || '15:00';
      const kickoff = new Date(`${today}T${kickoffTime}:00Z`);
      const matchApiId = hashString(`${today}-${f.homeTeam}-${f.awayTeam}`);

      // Skip recycled matches: same teams already exist within ±7 days OR already finished
      const dupCheck = await query(
        `SELECT id, status FROM matches
         WHERE home_team_id = $1 AND away_team_id = $2
           AND kickoff BETWEEN $3::timestamp - INTERVAL '7 days' AND $3::timestamp + INTERVAL '7 days'`,
        [homeTeam.id, awayTeam.id, kickoff]
      );
      if (dupCheck.rows.length > 0) {
        const isRecycled = dupCheck.rows.some((r: any) => r.status === 'finished');
        if (isRecycled) {
          logger.info(`Skipping recycled match: ${f.homeTeam} vs ${f.awayTeam} (already finished)`);
        }
        continue;
      }

      // Always ingest as scheduled — result sync picks up scores from livescore.com
      const match = await MatchModel.upsert({
        api_football_id: matchApiId,
        tournament_id: tournament.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff,
        status: 'scheduled',
        home_score: null,
        away_score: null,
      });

      // Store scraped odds
      await OddsModel.insert({
        match_id: match.id,
        bookmaker: 'scraped',
        market: '1x2',
        home_odds: f.homeOdds!,
        draw_odds: f.drawOdds!,
        away_odds: f.awayOdds!,
      });

      // Store scraped prediction
      const tip = f.tip || (f.homeWinProb! >= f.drawProb! && f.homeWinProb! >= f.awayWinProb! ? '1' :
        f.drawProb! >= f.awayWinProb! ? 'X' : '2');

      await predictionEngine.processPrediction(match.id, {
        homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        league: f.league, country: f.country, kickoff: kickoffTime,
      }, 0, {
        homeWinProb: f.homeWinProb!,
        drawProb: f.drawProb!,
        awayWinProb: f.awayWinProb!,
        confidence: Math.max(f.homeWinProb!, f.drawProb!, f.awayWinProb!),
        tip,
        reasoning: 'Scraped prediction',
      });

      ingested++;
    }

    logger.info(`Ingested ${ingested} matches with scraped predictions`);

    // Step 3: Pick of the Day
    await predictionEngine.selectPickOfDay(today);

    logger.info('Fixture ingestion complete');
  } catch (error: any) {
    logger.error(`Fixture ingestion failed: ${error.message}`);
  }
}
