import { query, getClient } from '../config/database';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
import * as PredictionModel from '../models/Prediction';
import { selectPickOfDay } from '../services/predictionEngine';

async function main() {
  console.log('Backfilling is_value_bet flags...');

  const res = await query(`
    SELECT p.id, p.tip, p.confidence, p.is_value_bet,
           oh.home_odds, oh.draw_odds, oh.away_odds
    FROM predictions p
    LEFT JOIN LATERAL (
      SELECT home_odds, draw_odds, away_odds
      FROM odds_history
      WHERE match_id = p.match_id
      ORDER BY scraped_at DESC, id DESC
      LIMIT 1
    ) oh ON true
  `);

  let fixed = 0;
  for (const row of res.rows) {
    const shouldBe = qualifiesByOdds(
      row.tip as Tip,
      row.home_odds != null ? Number(row.home_odds) : null,
      row.draw_odds != null ? Number(row.draw_odds) : null,
      row.away_odds != null ? Number(row.away_odds) : null,
      Number(row.confidence),
    );
    if (shouldBe !== row.is_value_bet) {
      await query('UPDATE predictions SET is_value_bet = $1 WHERE id = $2', [shouldBe, row.id]);
      fixed++;
      console.log(`  prediction_id=${row.id}: ${row.is_value_bet} -> ${shouldBe}`);
    }
  }
  console.log(`Fixed ${fixed} predictions.`);

  // Recompute POTDs for dates that were missing them
  const missingDates = ['2026-03-26', '2026-04-04'];
  for (const date of missingDates) {
    await PredictionModel.clearPickOfDay(date);
    const result = await selectPickOfDay(date);
    const matchId = result ? (result as any).match_id : null;
    console.log(`  ${date}: ${matchId != null ? `new POTD match_id=${matchId}` : 'still no POTD'}`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
