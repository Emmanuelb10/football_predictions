import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import logger from '../config/logger';

dayjs.extend(utc);
dayjs.extend(timezone);
import * as fixtureScraper from '../services/fixtureScraper';
import * as claudeService from '../services/claudeService';
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
  // Accept any league from prosoccer.gr even if not in our map
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
    // Step 1: Scrape fixtures from all sources (prosoccer.gr + zulubet.com)
    logger.info('Scraping all sources for fixtures...');
    let fixtures = await fixtureScraper.scrapeAllSources(today);

    if (fixtures.length === 0) {
      logger.info(`No fixtures scraped for ${today}`);
      return;
    }

    // Filter: must have odds, 70%+ probability, tipped odds in 1.50-1.99
    const qualified = fixtures.filter(f => {
      // Must have odds data
      if (!f.homeOdds || !f.drawOdds || !f.awayOdds) return false;

      const maxProb = Math.max(f.homeWinProb || 0, f.drawProb || 0, f.awayWinProb || 0);
      if (maxProb < 0.70) return false;

      const tipOdds =
        f.tip === '1' ? f.homeOdds :
        f.tip === '2' ? f.awayOdds :
        f.drawOdds;
      return tipOdds >= 1.50 && tipOdds <= 1.99;
    });

    const allMatches = qualified.length > 0 ? qualified : fixtures.filter(f =>
      Math.max(f.homeWinProb || 0, f.drawProb || 0, f.awayWinProb || 0) >= 0.70
    );
    logger.info(`${fixtures.length} total, ${qualified.length} with 70%+ prob AND odds 1.50-1.99`);

    if (allMatches.length === 0) {
      logger.info(`No qualifying fixtures for ${today}`);
      return;
    }

    logger.info(`Processing ${allMatches.length} fixtures for ${today}`);

    // Step 2: Store fixtures in DB
    let ingested = 0;
    const matchesNeedingPredictions: Array<{
      id: number; homeTeam: string; awayTeam: string;
      league: string; country: string; kickoff: string;
    }> = [];

    for (const f of allMatches) {
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

      const match = await MatchModel.upsert({
        api_football_id: matchApiId,
        tournament_id: tournament.id,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff,
        status: f.status || 'scheduled',
        home_score: f.homeScore ?? null,
        away_score: f.awayScore ?? null,
      });

      // Store scraped odds — skip match entirely if no odds
      if (f.homeOdds && f.drawOdds && f.awayOdds) {
        await OddsModel.insert({
          match_id: match.id,
          bookmaker: 'prosoccer',
          market: '1x2',
          home_odds: f.homeOdds,
          draw_odds: f.drawOdds,
          away_odds: f.awayOdds,
        });
      }

      // Store scraped prediction directly if available
      if (f.homeWinProb && f.drawProb && f.awayWinProb) {
        const tip = f.tip || (f.homeWinProb >= f.drawProb && f.homeWinProb >= f.awayWinProb ? '1' :
          f.drawProb >= f.awayWinProb ? 'X' : '2');

        await predictionEngine.processAIPrediction(match.id, {
          homeTeam: f.homeTeam, awayTeam: f.awayTeam,
          league: f.league, country: f.country, kickoff: kickoffTime,
        }, 0, {
          homeWinProb: f.homeWinProb,
          drawProb: f.drawProb,
          awayWinProb: f.awayWinProb,
          confidence: Math.max(f.homeWinProb, f.drawProb, f.awayWinProb),
          tip,
          reasoning: 'prosoccer.gr prediction',
        });
      } else {
        // Need Claude prediction for this match
        matchesNeedingPredictions.push({
          id: match.id, homeTeam: f.homeTeam, awayTeam: f.awayTeam,
          league: f.league, country: f.country, kickoff: kickoffTime,
        });
      }

      ingested++;
    }

    logger.info(`Ingested ${ingested} matches (${ingested - matchesNeedingPredictions.length} with scraped predictions)`);

    // Step 3: Get Claude predictions for matches without scraped predictions
    if (matchesNeedingPredictions.length > 0) {
      logger.info(`Requesting Claude predictions for ${matchesNeedingPredictions.length} matches`);
      const predictions = await claudeService.predictMatches(matchesNeedingPredictions);

      for (const match of matchesNeedingPredictions) {
        const pred = predictions.get(match.id);
        if (!pred) continue;

        await OddsModel.insert({
          match_id: match.id,
          bookmaker: 'claude_estimate',
          market: '1x2',
          home_odds: pred.estimatedOdds.home,
          draw_odds: pred.estimatedOdds.draw,
          away_odds: pred.estimatedOdds.away,
        });

        await predictionEngine.processAIPrediction(match.id, match, 0, pred);
      }
    }

    // Step 4: Pick of the Day
    await predictionEngine.selectPickOfDay(today);

    logger.info('Fixture ingestion complete');
  } catch (error: any) {
    logger.error(`Fixture ingestion failed: ${error.message}`);
  }
}
