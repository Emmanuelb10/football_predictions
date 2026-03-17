import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import * as MatchModel from '../models/Match';
import * as OddsModel from '../models/OddsHistory';
import logger from '../config/logger';

const router = Router();

// Track dates currently being ingested to avoid duplicate work
const ingestingDates = new Set<string>();

router.get('/', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD');
    let matches = await MatchModel.findByDate(date);

    // If no matches for this date, auto-ingest from prosoccer.gr
    if (matches.length === 0 && !ingestingDates.has(date)) {
      ingestingDates.add(date);
      logger.info(`No data for ${date}, auto-ingesting...`);

      try {
        const { ingestFixtures } = await import('../cron/fixtureIngestion');
        await ingestFixtures(date);
        matches = await MatchModel.findByDate(date);
        logger.info(`Auto-ingested ${matches.length} matches for ${date}`);
      } catch (err: any) {
        logger.error(`Auto-ingest failed for ${date}: ${err.message}`);
      } finally {
        ingestingDates.delete(date);
      }
    }

    // Attach latest odds to each match
    const matchIds = matches.map((m: any) => m.id);
    const allOdds = matchIds.length > 0 ? await OddsModel.getOddsForMatches(matchIds) : [];

    const enriched = matches.map((m: any) => {
      const matchOdds = allOdds.filter((o: any) => o.match_id === m.id);
      return {
        ...m,
        odds: matchOdds.map((o: any) => ({
          bookmaker: o.bookmaker,
          home: Number(o.home_odds),
          draw: Number(o.draw_odds),
          away: Number(o.away_odds),
        })),
      };
    });

    res.json({ date, matches: enriched });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
