import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import * as performanceTracker from '../services/performanceTracker';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const [summary, daily, oddsRange] = await Promise.all([
      performanceTracker.getPerformanceSummary(days),
      performanceTracker.getDailyBreakdown(days),
      performanceTracker.getOddsRangePerformance(),
    ]);
    res.json({ days, summary, daily, oddsRange });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/daily', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD');
    const pl = await performanceTracker.getDailyPL(date);
    res.json({ date, ...pl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
