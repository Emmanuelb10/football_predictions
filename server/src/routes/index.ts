import { Router, Request, Response } from 'express';
import matchesRouter from './matches';
import predictionsRouter from './predictions';
import performanceRouter from './performance';
import { env } from '../config/env';

const router = Router();

router.use('/matches', matchesRouter);
router.use('/predictions', predictionsRouter);
router.use('/performance', performanceRouter);

router.get('/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ai: {
      claude: env.CLAUDE_API_KEY ? 'configured' : 'missing',
      gemini: env.GEMINI_API_KEY ? 'configured' : 'not set (optional)',
    },
  });
});

// Manual trigger for fixture ingestion
router.post('/trigger/ingest', async (_req: Request, res: Response) => {
  try {
    const { ingestFixtures } = await import('../cron/fixtureIngestion');
    await ingestFixtures();
    res.json({ status: 'ok', message: 'Fixture ingestion triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
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
