import dayjs from 'dayjs';
import logger from '../config/logger';
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
  'la liga': { apiId: 140, country: 'Spain' },
  'serie a': { apiId: 135, country: 'Italy' },
  'bundesliga': { apiId: 78, country: 'Germany' },
  'ligue 1': { apiId: 61, country: 'France' },
  'primeira liga': { apiId: 94, country: 'Portugal' },
  'liga portugal': { apiId: 94, country: 'Portugal' },
  'eredivisie': { apiId: 88, country: 'Netherlands' },
  'uefa champions league': { apiId: 2, country: 'World' },
  'champions league': { apiId: 2, country: 'World' },
  'uefa europa league': { apiId: 3, country: 'World' },
  'europa league': { apiId: 3, country: 'World' },
  'uefa conference league': { apiId: 848, country: 'World' },
  'conference league': { apiId: 848, country: 'World' },
};

function findLeague(name: string): { apiId: number; country: string } | null {
  const lower = name.toLowerCase().trim();
  // Exact match first
  if (LEAGUE_MAP[lower]) return LEAGUE_MAP[lower];
  // Partial match
  for (const [key, val] of Object.entries(LEAGUE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return null;
}

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export async function ingestFixtures() {
  const today = dayjs().format('YYYY-MM-DD');
  logger.info(`Starting fixture ingestion for ${today}`);

  try {
    // Step 1: Scrape fixtures from free web sources
    const fixtures = await fixtureScraper.scrapeFixtures(today);

    if (fixtures.length === 0) {
      // Fallback: ask Claude for fixtures
      logger.info('No fixtures from web sources, asking Claude...');
      const claudeFixtures = await claudeService.fetchFixtures(today);
      fixtures.push(...claudeFixtures);
    }

    if (fixtures.length === 0) {
      logger.info(`No fixtures found for ${today}`);
      return;
    }

    logger.info(`Got ${fixtures.length} fixtures for ${today}`);

    // Step 2: Store fixtures in DB
    let ingested = 0;
    const storedMatches: Array<{
      id: number; homeTeam: string; awayTeam: string;
      league: string; country: string; kickoff: string;
    }> = [];

    for (const f of fixtures) {
      const leagueInfo = findLeague(f.league);
      if (!leagueInfo) {
        logger.debug(`Skipping untracked league: ${f.league}`);
        continue;
      }

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

      storedMatches.push({
        id: match.id, homeTeam: f.homeTeam, awayTeam: f.awayTeam,
        league: f.league, country: f.country || leagueInfo.country, kickoff: kickoffTime,
      });
      ingested++;
    }

    logger.info(`Ingested ${ingested} matches`);

    // Step 3: Claude predictions + estimated odds (single batch call)
    if (storedMatches.length > 0) {
      logger.info(`Requesting Claude predictions for ${storedMatches.length} matches`);
      const predictions = await claudeService.predictMatches(storedMatches);

      for (const match of storedMatches) {
        const pred = predictions.get(match.id);
        if (!pred) continue;

        // Store Claude's estimated odds
        await OddsModel.insert({
          match_id: match.id,
          bookmaker: 'claude_estimate',
          market: '1x2',
          home_odds: pred.estimatedOdds.home,
          draw_odds: pred.estimatedOdds.draw,
          away_odds: pred.estimatedOdds.away,
        });

        // Store prediction
        await predictionEngine.processAIPrediction(match.id, match, 0, pred);
      }

      await predictionEngine.selectPickOfDay(today);
    }

    logger.info('Fixture ingestion complete');
  } catch (error: any) {
    logger.error(`Fixture ingestion failed: ${error.message}`);
  }
}
