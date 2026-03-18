import cron from 'node-cron';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import logger from '../config/logger';
import { ingestFixtures } from './fixtureIngestion';
import { syncOdds } from './oddsSync';
import { syncResults } from './resultSync';
import { query } from '../config/database';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Africa/Nairobi';
const STALE_HOURS = 5;

/**
 * Get the Sunday–Saturday week boundaries for a given date.
 * e.g. if today is Wed Mar 18, returns Sun Mar 15 – Sat Mar 21.
 */
function getWeekRange(now: dayjs.Dayjs): { start: dayjs.Dayjs; end: dayjs.Dayjs } {
  const dow = now.day(); // 0=Sun, 1=Mon, ..., 6=Sat
  const start = now.subtract(dow, 'day');     // Sunday
  const end = start.add(6, 'day');            // Saturday
  return { start, end };
}

/**
 * Sync fixtures for the full Sun–Sat week.
 * Skips days that were ingested within the last STALE_HOURS.
 */
async function syncWeeklyFixtures() {
  const now = dayjs().tz(TZ);
  const { start, end } = getWeekRange(now);
  logger.info(`Weekly sync: ${start.format('YYYY-MM-DD')} (Sun) to ${end.format('YYYY-MM-DD')} (Sat) [${now.format('HH:mm')} ${TZ}]`);

  let synced = 0;
  for (let d = start; d.isBefore(end.add(1, 'day')); d = d.add(1, 'day')) {
    const date = d.format('YYYY-MM-DD');

    const res = await query(
      `SELECT COUNT(*) as count, MAX(created_at) as latest
       FROM matches m WHERE DATE(m.kickoff AT TIME ZONE $1) = $2`,
      [TZ, date]
    );

    const count = parseInt(res.rows[0].count);
    const latest = res.rows[0].latest ? dayjs(res.rows[0].latest) : null;
    const isStale = !latest || dayjs().diff(latest, 'hour') >= STALE_HOURS;

    if (count === 0 || isStale) {
      logger.info(`Syncing ${date} (${count === 0 ? 'missing' : 'stale'})`);
      try {
        await ingestFixtures(date);
        synced++;
        // Pause between days to avoid rate limiting
        await new Promise(r => setTimeout(r, 3000));
      } catch (err: any) {
        logger.error(`Fixture sync failed for ${date}: ${err.message}`);
      }
    }
  }

  if (synced > 0) {
    logger.info(`Weekly sync complete: ${synced} days ingested. Syncing results...`);
    await syncResults();
  } else {
    logger.info('Weekly sync: all days are fresh');
  }
}

export function startCronJobs() {
  // Weekly fixture sync every 5 hours (Africa/Nairobi)
  cron.schedule('0 */5 * * *', async () => {
    logger.info('CRON: Weekly fixture sync starting');
    await syncWeeklyFixtures();
  }, { timezone: TZ });

  // Odds sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('CRON: Odds sync starting');
    await syncOdds();
  }, { timezone: TZ });

  // Result sync every 10 minutes during peak match hours (17:00-06:00 EAT)
  cron.schedule('*/10 17-23,0-6 * * *', async () => {
    logger.info('CRON: Result sync starting');
    await syncResults();
  }, { timezone: TZ });

  logger.info(`Cron jobs registered (${TZ}): fixture sync (*/5hr), odds sync (*/15min), result sync (*/10min 17-06)`);

  // Run weekly sync immediately on startup (non-blocking)
  syncWeeklyFixtures().catch(err => logger.error(`Startup sync error: ${err.message}`));
}
