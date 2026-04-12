import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as performanceTracker from '../services/performanceTracker';
import { isValidDateString } from '../utils/dateValidation';

dayjs.extend(utc);
dayjs.extend(timezone);

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
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const pl = await performanceTracker.getDailyPL(date);
    res.json({ date, ...pl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
