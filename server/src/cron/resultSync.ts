import dayjs from 'dayjs';
import logger from '../config/logger';
import { query } from '../config/database';
import { fetchFinishedResults, fetchSofascoreResults, teamsMatch } from '../services/livescoreFetcher';
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
      // Fetch from livescore.com (primary)
      let results = await fetchFinishedResults(date);

      // If livescore returns few results, also try sofascore
      if (results.length < 20) {
        const sofaResults = await fetchSofascoreResults(date);
        // Merge, dedup by team name
        const seen = new Set(results.map(r => r.homeTeam.toUpperCase()));
        for (const r of sofaResults) {
          if (!seen.has(r.homeTeam.toUpperCase())) results.push(r);
        }
      }

      if (results.length === 0) continue;
      logger.info(`${results.length} finished results for ${date}`);

      // Match each pending match
      for (const m of matches) {
        const res = await query(
          `SELECT ht.name as home, at2.name as away
           FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
           WHERE m.id=$1`, [m.id]
        );
        if (!res.rows[0]) continue;
        const { home, away } = res.rows[0];

        const result = results.find(lr =>
          teamsMatch(home, lr.homeTeam) && teamsMatch(away, lr.awayTeam)
        );

        if (result) {
          await query(
            'UPDATE matches SET home_score=$1, away_score=$2, status=$3, updated_at=NOW() WHERE id=$4',
            [result.homeScore, result.awayScore, 'finished', m.id]
          );
          updated++;
          logger.info(`Result: ${home} ${result.homeScore}-${result.awayScore} ${away}`);
        }
      }
    }

    logger.info(`Result sync complete: ${updated} updated`);
  } catch (error: any) {
    logger.error(`Result sync failed: ${error.message}`);
  }
}
