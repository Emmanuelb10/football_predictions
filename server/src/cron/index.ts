import cron from 'node-cron';
import logger from '../config/logger';
import { ingestFixtures } from './fixtureIngestion';
import { syncOdds } from './oddsSync';
import { syncResults } from './resultSync';

export function startCronJobs() {
  // Daily fixture ingestion at 06:00 UTC
  cron.schedule('0 6 * * *', async () => {
    logger.info('CRON: Daily fixture ingestion starting');
    await ingestFixtures();
  }, { timezone: 'UTC' });

  // Odds sync every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    logger.info('CRON: Odds sync starting');
    await syncOdds();
  }, { timezone: 'UTC' });

  // Result sync every 10 minutes between 14:00-03:00 UTC (peak match hours)
  cron.schedule('*/10 14-23,0-3 * * *', async () => {
    logger.info('CRON: Result sync starting');
    await syncResults();
  }, { timezone: 'UTC' });

  logger.info('Cron jobs registered: fixture ingestion (06:00), odds sync (*/15min), result sync (*/10min 14-03)');
}
