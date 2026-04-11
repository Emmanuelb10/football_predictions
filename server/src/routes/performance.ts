import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as performanceTracker from '../services/performanceTracker';

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();

const LAUNCH_DATE = '2026-03-16';

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
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (date < LAUNCH_DATE) { res.json({ date, totalPicks: 0, settled: 0, pending: 0, void: 0, wins: 0, losses: 0, profitUnits: 0, streak: { type: 'W', count: 0 } }); return; }
    const pl = await performanceTracker.getDailyPL(date);
    res.json({ date, ...pl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
