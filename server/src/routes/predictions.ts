import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import * as PredictionModel from '../models/Prediction';

const router = Router();

router.get('/pick-of-day', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD');
    const pick = await PredictionModel.findPickOfDay(date);
    res.json({ date, pick: pick || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
