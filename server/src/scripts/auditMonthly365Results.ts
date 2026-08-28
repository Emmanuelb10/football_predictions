import dayjs from 'dayjs';
import { query } from '../config/database';
import { selectVerifiedCorrection } from '../cron/resultSync';
import { fetch365ScoresResults } from '../services/scores365Fetcher';

interface StoredResult {
  id: number;
  kickoff: Date;
  home_score: number;
  away_score: number;
  home: string;
  away: string;
}

const month = process.argv[2];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
  throw new Error('Usage: ts-node src/scripts/auditMonthly365Results.ts YYYY-MM');
}

async function auditMonth() {
  const start = `${month}-01`;
  const end = dayjs(start).add(1, 'month').format('YYYY-MM-DD');
  const stored = await query(
    `SELECT m.id, m.kickoff, m.home_score, m.away_score, ht.name AS home, at2.name AS away
     FROM matches m
     JOIN teams ht ON ht.id=m.home_team_id
     JOIN teams at2 ON at2.id=m.away_team_id
     WHERE m.status='finished' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
       AND m.kickoff >= $1::timestamptz AND m.kickoff < $2::timestamptz
     ORDER BY m.kickoff`,
    [start, end],
  );

  const byDate = new Map<string, StoredResult[]>();
  for (const match of stored.rows as StoredResult[]) {
    const date = dayjs(match.kickoff).format('YYYY-MM-DD');
    byDate.set(date, [...(byDate.get(date) ?? []), match]);
  }

  let checked = 0;
  let corrected = 0;
  let unavailable = 0;
  for (const [date, matches] of byDate) {
    const results = await fetch365ScoresResults(date);
    if (results.length === 0) unavailable += matches.length;

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
      }
      checked++;
    }
  }

  console.log(`365Scores ${month} audit complete: ${checked} checked, ${corrected} corrected, ${unavailable} unavailable.`);
}

auditMonth().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
