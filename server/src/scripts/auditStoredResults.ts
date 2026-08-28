import dayjs from 'dayjs';
import { query } from '../config/database';
import type { LivescoreMatch } from '../services/livescoreFetcher';
import { selectVerifiedCorrection } from '../cron/resultSync';
import { fetchBbcResults } from '../services/bbcFetcher';

interface StoredResult {
  id: number;
  kickoff: Date;
  home_score: number;
  away_score: number;
  home: string;
  away: string;
}

async function resultsForDate(date: string): Promise<LivescoreMatch[]> {
  const dates = [
    dayjs(date).subtract(1, 'day').format('YYYY-MM-DD'),
    date,
    dayjs(date).add(1, 'day').format('YYYY-MM-DD'),
  ];
  const boards = await Promise.all(dates.map(async resultDate =>
    (await fetchBbcResults(resultDate)).map(result => ({
      ...result, resultDate, source: 'bbc' as const,
    }))
  ));
  return boards.flat();
}

/**
 * Reconcile all stored final scores against the primary score authority. It
 * intentionally leaves an unverified or ambiguous row untouched.
 */
async function auditStoredResults() {
  const stored = await query(
    `SELECT m.id, m.kickoff, m.home_score, m.away_score, ht.name AS home, at2.name AS away
     FROM matches m
     JOIN teams ht ON ht.id=m.home_team_id
     JOIN teams at2 ON at2.id=m.away_team_id
     WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
     ORDER BY m.kickoff ASC`,
  );

  const dates = new Map<string, StoredResult[]>();
  for (const match of stored.rows as StoredResult[]) {
    const date = dayjs(match.kickoff).format('YYYY-MM-DD');
    dates.set(date, [...(dates.get(date) ?? []), match]);
  }

  let checked = 0;
  let corrected = 0;
  let unverified = 0;
  const auditDate = async ([date, matches]: [string, StoredResult[]]) => {
    const results = await resultsForDate(date);
    for (const match of matches) {
      const correction = selectVerifiedCorrection(
        match.home, match.away, match.home_score, match.away_score, results, date,
      );
      if (correction) {
        await query(
          `UPDATE matches SET home_score=$1, away_score=$2, updated_at=NOW() WHERE id=$3`,
          [correction.homeScore, correction.awayScore, match.id],
        );
        corrected++;
        console.log(`Corrected ${match.id}: ${match.home} ${correction.homeScore}-${correction.awayScore} ${match.away}`);
      } else if (!results.length) {
        unverified++;
      }
      checked++;
    }
  };

  // Audit one date at a time. Each date queries several public providers and
  // retrying them in parallel can trigger their rate limits or socket resets.
  const dateEntries = [...dates.entries()];
  for (const entry of dateEntries) {
    await auditDate(entry);
  }

  console.log(`Audit complete: ${checked} checked, ${corrected} corrected, ${unverified} unverified (no provider data).`);
}

auditStoredResults().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
