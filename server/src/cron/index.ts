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
const STALE_HOURS = 1;

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
 * Sync fixtures for the full Sun–Sat week + next 3 days.
 * Ensures tomorrow and upcoming days are always covered.
 * Skips days that were ingested within the last STALE_HOURS.
 */
async function syncWeeklyFixtures() {
  const now = dayjs().tz(TZ);
  const { start, end: weekEnd } = getWeekRange(now);
  // Extend to cover at least 3 days beyond today (catches next week's early matches)
  const tomorrow3 = now.add(3, 'day');
  const end = tomorrow3.isAfter(weekEnd) ? tomorrow3 : weekEnd;
  logger.info(`Fixture sync: ${start.format('YYYY-MM-DD')} to ${end.format('YYYY-MM-DD')} [${now.format('HH:mm')} ${TZ}]`);

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
    const isToday = date === now.format('YYYY-MM-DD');
    const isTomorrow = date === now.add(1, 'day').format('YYYY-MM-DD');

    // Always re-scrape today and tomorrow (prediction sites update throughout the day)
    if (count === 0 || isStale || isToday || isTomorrow) {
      logger.info(`Syncing ${date} (${count === 0 ? 'missing' : isToday ? 'today' : isTomorrow ? 'tomorrow' : 'stale'})`);
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
    logger.info(`Fixture sync complete: ${synced} days ingested. Syncing results...`);
    await syncResults();
  } else {
    logger.info('Fixture sync: all days are fresh');
  }
}

export function startCronJobs() {
  // Full week fixture sync every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('CRON: Hourly full-week fixture sync');
    await syncWeeklyFixtures();
  }, { timezone: TZ });

  // Fast sync for today + tomorrow every 30 minutes — catches zulubet/prosoccer updates quickly
  cron.schedule('*/30 * * * *', async () => {
    const now = dayjs().tz(TZ);
    const today = now.format('YYYY-MM-DD');
    const tomorrow = now.add(1, 'day').format('YYYY-MM-DD');
    logger.info(`CRON: Fast sync for ${today} and ${tomorrow}`);
    try {
      await ingestFixtures(today);
      await new Promise(r => setTimeout(r, 2000));
      await ingestFixtures(tomorrow);
    } catch (err: any) {
      logger.error(`Fast sync failed: ${err.message}`);
    }
  }, { timezone: TZ });

  // Odds sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('CRON: Odds sync starting');
    await syncOdds();
  }, { timezone: TZ });

  // Result sync every 5 minutes, 24/7 — catches results as soon as matches end
  cron.schedule('*/5 * * * *', async () => {
    await syncResults();
  }, { timezone: TZ });

  logger.info(`Cron jobs registered (${TZ}): fixture sync (hourly), fast sync today+tomorrow (*/30min), odds sync (*/15min), result sync (*/5min)`);

  // Run weekly sync immediately on startup (non-blocking)
  syncWeeklyFixtures().catch(err => logger.error(`Startup sync error: ${err.message}`));
}
