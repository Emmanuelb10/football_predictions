import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import logger from '../config/logger';
import { query } from '../config/database';
import { scrapeOdds } from '../services/oddsScraper';
import * as OddsModel from '../models/OddsHistory';
import { qualifiesByOdds, type Tip } from '../utils/qualification';

dayjs.extend(utc);
dayjs.extend(timezone);

export async function syncOdds() {
  const today = dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
  logger.info(`Starting odds sync for ${today}`);

  try {
    const scraped = await scrapeOdds(today);
    if (scraped === 0) {
      logger.info('No new odds scraped. Using Claude estimated odds.');
    }

    await recomputeValueBets(today);
    logger.info('Odds sync complete');
  } catch (error: any) {
    logger.error(`Odds sync failed: ${error.message}`);
  }
}

async function recomputeValueBets(date: string) {
  const res = await query(
    `SELECT p.* FROM predictions p JOIN matches m ON p.match_id = m.id
     WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  for (const pred of res.rows) {
    const odds = await OddsModel.getLatestOdds(pred.match_id);
    if (!odds) continue;

    const tipOdds =
      pred.tip === '1' ? Number(odds.home_odds) :
      pred.tip === 'X' ? Number(odds.draw_odds) :
      Number(odds.away_odds);

    const ev = Number(pred.confidence) * tipOdds - 1;
    // Use the shared qualifier so is_value_bet stays consistent with every
    // other filter site. A previous inline check used a strict > 1.50 lower
    // bound and no opposing-side check, which silently reintroduced stale
    // non-conforming flags every 15 minutes after Phase 2 cleanup.
    const valueBet = qualifiesByOdds(
      pred.tip as Tip,
      odds.home_odds != null ? Number(odds.home_odds) : null,
      odds.draw_odds != null ? Number(odds.draw_odds) : null,
      odds.away_odds != null ? Number(odds.away_odds) : null,
      Number(pred.confidence),
    );

    await query('UPDATE predictions SET expected_value = $1, is_value_bet = $2 WHERE id = $3', [ev, valueBet, pred.id]);
  }
}
