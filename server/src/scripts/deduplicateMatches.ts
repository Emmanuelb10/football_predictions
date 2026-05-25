import { getClient } from '../config/database';
import * as PredictionModel from '../models/Prediction';
import { selectEvPick, selectPickOfDay } from '../services/predictionEngine';
import { findSameFixtureCandidate, type ExistingFixtureCandidate } from '../utils/matchIdentity';

const APPLY = process.argv.includes('--apply');

interface MatchRow extends ExistingFixtureCandidate {
  nairobi_date: string;
}

interface DuplicateMatch {
  keep: MatchRow;
  remove: MatchRow;
}

function findDuplicateMatches(matches: MatchRow[]): DuplicateMatch[] {
  const duplicates: DuplicateMatch[] = [];
  const kept: MatchRow[] = [];

  for (const match of matches) {
    const windowStart = match.kickoff.getTime() - 7 * 24 * 60 * 60 * 1000;
    const candidates = kept.filter(candidate =>
      candidate.kickoff.getTime() >= windowStart &&
      candidate.kickoff.getTime() <= match.kickoff.getTime() + 7 * 24 * 60 * 60 * 1000
    );
    const duplicate = findSameFixtureCandidate(candidates, {
      homeTeam: match.home_team,
      awayTeam: match.away_team,
    });

    if (duplicate) {
      duplicates.push({ keep: duplicate, remove: match });
    } else {
      kept.push(match);
    }
  }

  return duplicates;
}

async function main() {
  const client = await getClient();

  try {
    const res = await client.query(
      `SELECT m.id, m.status, m.kickoff,
              TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS nairobi_date,
              ht.name as home_team, at2.name as away_team
       FROM matches m
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       ORDER BY m.kickoff ASC, m.id ASC`
    );

    const duplicates = findDuplicateMatches(res.rows);
    console.log(`Found ${duplicates.length} duplicate match rows.`);

    for (const { keep, remove } of duplicates) {
      console.log(
        `  remove ${remove.id} (${remove.nairobi_date}: ${remove.home_team} vs ${remove.away_team}) ` +
        `duplicate of ${keep.id} (${keep.nairobi_date}: ${keep.home_team} vs ${keep.away_team})`
      );
    }

    if (!APPLY) {
      console.log('DRY-RUN: no changes made. Re-run with --apply to delete duplicate rows.');
      return;
    }

    if (duplicates.length === 0) {
      console.log('No duplicate rows to delete.');
      return;
    }

    const ids = duplicates.map(d => d.remove.id);
    const affectedDates = Array.from(new Set(duplicates.map(d => d.remove.nairobi_date))).sort();

    await client.query('BEGIN');
    const del = await client.query('DELETE FROM matches WHERE id = ANY($1)', [ids]);
    await client.query('COMMIT');
    console.log(`Deleted ${del.rowCount} duplicate matches.`);

    for (const date of affectedDates) {
      await PredictionModel.clearPickOfDay(date);
      await PredictionModel.clearEvPick(date);
      const potd = await selectPickOfDay(date);
      const evPick = await selectEvPick(date);
      console.log(
        `  ${date}: POTD ${potd ? `match_id=${potd.match_id}` : 'none'}, ` +
        `EV ${evPick ? `match_id=${evPick.match_id}` : 'none'}`
      );
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
