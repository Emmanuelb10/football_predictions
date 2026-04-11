import { getClient } from '../config/database';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
import * as PredictionModel from '../models/Prediction';
import { selectPickOfDay } from '../services/predictionEngine';

const DRY_RUN = process.argv.includes('--dry-run');

interface NonConforming {
  id: number;
  date: string;
  home: string;
  away: string;
  tip: string;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  confidence: number;
  reason: string;
}

function describeReason(row: NonConforming): string {
  if (row.confidence < 0.70) return `confidence ${row.confidence.toFixed(2)} < 0.70`;
  if (row.homeOdds == null || row.drawOdds == null || row.awayOdds == null) return 'missing odds';
  const tipOdds = row.tip === '1' ? row.homeOdds : row.tip === '2' ? row.awayOdds : row.drawOdds;
  if (tipOdds < 1.50 || tipOdds > 1.99) return `tipped odds ${tipOdds.toFixed(2)} outside [1.50, 1.99]`;
  const opposingOdds = row.tip === '1' ? row.awayOdds : row.tip === '2' ? row.homeOdds : Math.min(row.homeOdds, row.awayOdds);
  return `opposing odds ${opposingOdds.toFixed(2)} < 5.00`;
}

async function main() {
  console.log(`Cleanup starting (${DRY_RUN ? 'DRY-RUN' : 'REAL'} mode)`);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Set a lock timeout so we fail fast if another connection holds matches
    // instead of hanging. Cron should be paused before running this script;
    // the timeout is a defensive backstop.
    await client.query("SET LOCAL lock_timeout = '10s'");
    // Block concurrent ingests/result-syncs during the scan+delete window.
    await client.query('LOCK TABLE matches IN SHARE ROW EXCLUSIVE MODE');

    const res = await client.query(`
      SELECT m.id,
             TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS nairobi_date,
             ht.name AS home, at2.name AS away,
             p.tip, p.confidence,
             oh.home_odds, oh.draw_odds, oh.away_odds
      FROM matches m
      JOIN predictions p ON p.match_id = m.id
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at2 ON m.away_team_id = at2.id
      LEFT JOIN LATERAL (
        SELECT home_odds, draw_odds, away_odds
        FROM odds_history
        WHERE match_id = m.id
        ORDER BY scraped_at DESC, id DESC
        LIMIT 1
      ) oh ON true
    `);

    const nonConforming: NonConforming[] = [];
    for (const row of res.rows) {
      const tip = row.tip as Tip;
      const probability = Number(row.confidence);
      const homeOdds = row.home_odds != null ? Number(row.home_odds) : null;
      const drawOdds = row.draw_odds != null ? Number(row.draw_odds) : null;
      const awayOdds = row.away_odds != null ? Number(row.away_odds) : null;
      const ok = qualifiesByOdds(tip, homeOdds, drawOdds, awayOdds, probability);
      if (!ok) {
        const nc: NonConforming = {
          id: row.id,
          date: row.nairobi_date,
          home: row.home,
          away: row.away,
          tip: row.tip,
          homeOdds,
          drawOdds,
          awayOdds,
          confidence: probability,
          reason: '',
        };
        nc.reason = describeReason(nc);
        nonConforming.push(nc);
      }
    }

    console.log(`Found ${nonConforming.length} non-conforming matches`);
    for (const nc of nonConforming) {
      console.log(`  match_id=${nc.id} date=${nc.date} ${nc.home} vs ${nc.away} (tip=${nc.tip}): ${nc.reason}`);
    }
    const affectedDates = Array.from(new Set(nonConforming.map(n => n.date))).sort();
    console.log(`Affected dates (${affectedDates.length}): ${affectedDates.join(', ')}`);

    if (DRY_RUN) {
      console.log('DRY-RUN: rolling back, no changes committed.');
      await client.query('ROLLBACK');
      return;
    }

    if (nonConforming.length > 0) {
      const ids = nonConforming.map(n => n.id);
      // Deleting matches cascades to predictions and odds_history via ON DELETE CASCADE.
      const del = await client.query('DELETE FROM matches WHERE id = ANY($1)', [ids]);
      console.log(`Deleted ${del.rowCount} matches (cascade cleaned predictions + odds_history)`);
    }

    await client.query('COMMIT');
    console.log('Deletion transaction committed.');

    // Recompute POTD for affected dates. Each date is independent; failures are
    // logged but do not roll back earlier successes. The script is idempotent,
    // so re-running after a partial failure will continue where it stopped.
    for (const date of affectedDates) {
      try {
        await PredictionModel.clearPickOfDay(date);
        const result = await selectPickOfDay(date);
        // selectPickOfDay returns the winning candidate row from the predictions
        // SELECT, which has both `id` (prediction id) and `match_id`. Log match_id
        // since that's what the rest of the system references.
        const matchId = result ? (result as any).match_id : null;
        console.log(`  ${date}: ${matchId != null ? `new POTD match_id=${matchId}` : 'no POTD'}`);
      } catch (err: any) {
        console.error(`  ${date}: recomputation failed: ${err.message}`);
      }
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Cleanup failed, rolling back:', err);
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
