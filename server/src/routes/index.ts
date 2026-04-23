import { Router, Request, Response } from 'express';
import matchesRouter from './matches';
import predictionsRouter from './predictions';
import performanceRouter from './performance';
import { isValidDateString } from '../utils/dateValidation';

const router = Router();

router.use('/matches', matchesRouter);
router.use('/predictions', predictionsRouter);
router.use('/performance', performanceRouter);

router.get('/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sources: ['livescore.com', 'prosoccer.gr', 'zulubet.com'],
  });
});

// Manual trigger for fixture ingestion (accepts ?date=YYYY-MM-DD) — fire and forget
router.post('/trigger/ingest', async (req: Request, res: Response) => {
  const { ingestFixtures } = await import('../cron/fixtureIngestion');
  const date = req.query.date as string | undefined;
  if (date && !isValidDateString(date)) {
    res.status(400).json({ error: 'Invalid date', date });
    return;
  }
  res.json({ status: 'ok', message: `Fixture ingestion started for ${date || 'today'}` });
  ingestFixtures(date).catch((e: any) => console.error('Ingestion error:', e.message));
});

// Manual trigger for odds sync
router.post('/trigger/odds', async (_req: Request, res: Response) => {
  try {
    const { syncOdds } = await import('../cron/oddsSync');
    await syncOdds();
    res.json({ status: 'ok', message: 'Odds sync triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for POTD re-selection
router.post('/trigger/potd', async (req: Request, res: Response) => {
  try {
    const { selectPickOfDay } = await import('../services/predictionEngine');
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const result = await selectPickOfDay(date);
    res.json({ status: 'ok', date, pick: result?.id || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for EV Pick re-selection
router.post('/trigger/ev-pick', async (req: Request, res: Response) => {
  try {
    const { selectEvPick } = await import('../services/predictionEngine');
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const result = await selectEvPick(date);
    res.json({ status: 'ok', date, pick: result?.id || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for result sync
router.post('/trigger/results', async (_req: Request, res: Response) => {
  try {
    const { syncResults } = await import('../cron/resultSync');
    await syncResults();
    res.json({ status: 'ok', message: 'Result sync triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
