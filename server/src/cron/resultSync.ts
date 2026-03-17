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

    // Group by date
    const byDate = new Map<string, any[]>();
    for (const m of pendingMatches) {
      const date = dayjs(m.kickoff).format('YYYY-MM-DD');
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(m);
    }

    let updated = 0;

    for (const [date, matches] of byDate) {
      // Re-scrape prosoccer.gr for this date — it may now show scores
      logger.info(`Re-scraping prosoccer.gr for results on ${date}`);
      const scraped = await fixtureScraper.scrapeFixtures(date);

      // Get team names for our pending matches
      for (const m of matches) {
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        // Try to find this match in the scraped data (fuzzy name matching)
        const match = scraped.find(s =>
          (s.homeTeam.toUpperCase().includes(home.toUpperCase()) ||
           home.toUpperCase().includes(s.homeTeam.toUpperCase())) &&
          (s.awayTeam.toUpperCase().includes(away.toUpperCase()) ||
           away.toUpperCase().includes(s.awayTeam.toUpperCase()))
        );

        if (match && match.homeScore != null && match.awayScore != null) {
          await query(
            'UPDATE matches SET home_score=$1, away_score=$2, status=$3, updated_at=NOW() WHERE id=$4',
            [match.homeScore, match.awayScore, 'finished', m.id]
          );
          updated++;
          logger.info(`Result: ${home} ${match.homeScore}-${match.awayScore} ${away}`);
        }
      }
    }

    logger.info(`Result sync complete: ${updated} updated`);
  } catch (error: any) {
    logger.error(`Result sync failed: ${error.message}`);
  }
}
