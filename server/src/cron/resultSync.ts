import dayjs from 'dayjs';
import logger from '../config/logger';
import { query } from '../config/database';
import * as fixtureScraper from '../services/fixtureScraper';
import * as MatchModel from '../models/Match';

export async function syncResults() {
  logger.info('Starting result sync');

  try {
    const pendingMatches = await MatchModel.findPendingResults();
    if (pendingMatches.length === 0) {
      logger.info('No pending results to sync');
      return;
    }

    // Get finished fixtures from web sources for recent dates
    const dates = new Set(pendingMatches.map((m: any) =>
      dayjs(m.kickoff).format('YYYY-MM-DD')
    ));

    let updated = 0;
    for (const date of dates) {
      const results = await fixtureScraper.scrapeResults(date);

      // Match results to our pending matches by team names
      for (const result of results) {
        if (result.homeScore == null || result.awayScore == null) continue;

        const matchRes = await query(
          `SELECT m.id FROM matches m
           JOIN teams ht ON m.home_team_id = ht.id
           JOIN teams at2 ON m.away_team_id = at2.id
           WHERE m.status = 'scheduled'
             AND DATE(m.kickoff AT TIME ZONE 'UTC') = $1
             AND (LOWER(ht.name) = LOWER($2) OR ht.name ILIKE $3)
             AND (LOWER(at2.name) = LOWER($4) OR at2.name ILIKE $5)
           LIMIT 1`,
          [date, result.homeTeam, `%${result.homeTeam}%`, result.awayTeam, `%${result.awayTeam}%`]
        );

        if (matchRes.rows[0]) {
          await MatchModel.updateResult(matchRes.rows[0].id, result.homeScore, result.awayScore, 'finished');
          updated++;
          logger.info(`Result: ${result.homeTeam} ${result.homeScore}-${result.awayScore} ${result.awayTeam}`);
        }
      }
    }

    logger.info(`Result sync complete: ${updated} updated`);
  } catch (error: any) {
    logger.error(`Result sync failed: ${error.message}`);
  }
}
