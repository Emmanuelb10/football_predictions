import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as MatchModel from '../models/Match';
import * as OddsModel from '../models/OddsHistory';
import { query } from '../config/database';
import logger from '../config/logger';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
import { isValidDateString } from '../utils/dateValidation';

dayjs.extend(utc);
dayjs.extend(timezone);

const router = Router();

// Track dates currently being ingested to avoid duplicate work
const ingestingDates = new Set<string>();

router.get('/', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');

    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }

    let matches = await MatchModel.findByDate(date);

    // Auto-ingest if no matches exist for this date (only once per date)
    if (matches.length === 0 && !ingestingDates.has(date)) {
      // Check if we already tried this date (avoid repeated scraping on empty days)
      const attempted = await query(
        `SELECT COUNT(*) as c FROM matches WHERE DATE(kickoff AT TIME ZONE 'Africa/Nairobi') = $1`, [date]
      );
      if (Number(attempted.rows[0].c) === 0) {
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
    }

    // Auto-sync results for past dates with unfinished matches
    const today = dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (date < today && matches.some((m: any) => m.status === 'scheduled')) {
      try {
        const { syncResultsForDate } = await import('../cron/resultSync');
        await syncResultsForDate(date);
        matches = await MatchModel.findByDate(date);
      } catch (err: any) {
        logger.error(`Auto result sync failed for ${date}: ${err.message}`);
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

    // Filter by the shared qualification rule.
    const filtered = enriched.filter((m: any) => {
      if (!m.tip || !m.odds || m.odds.length === 0) return false;
      const o = m.odds[0];
      return qualifiesByOdds(
        m.tip as Tip,
        o.home ?? null,
        o.draw ?? null,
        o.away ?? null,
        Number(m.confidence) || 0,
      );
    });

    res.json({ date, matches: filtered });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Settled matches since timestamp — for live result polling
// Also triggers a quick result sync if there are matches that should have ended
router.get('/settled', async (req: Request, res: Response) => {
  try {
    // Check if any matches should have finished by now (kickoff > 105 min ago, still scheduled)
    const pending = await query(
      `SELECT COUNT(*) as c FROM matches WHERE status = 'scheduled' AND kickoff < NOW() - INTERVAL '105 minutes'`
    );
    if (Number(pending.rows[0].c) > 0) {
      try {
        const { syncResults } = await import('../cron/resultSync');
        await syncResults();
      } catch {
        // Silent — cron will catch it
      }
    }

    const since = (req.query.since as string) || new Date(Date.now() - 3600000).toISOString();
    const res2 = await query(
      `SELECT m.id, m.home_score, m.away_score, m.status, m.updated_at,
              p.tip, p.confidence
       FROM matches m LEFT JOIN predictions p ON p.match_id = m.id
       WHERE m.status = 'finished' AND m.updated_at > $1
       ORDER BY m.updated_at DESC`,
      [since]
    );

    const settled = res2.rows.map((r: any) => {
      const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
      return {
        id: r.id,
        homeScore: r.home_score,
        awayScore: r.away_score,
        tip: r.tip,
        won: r.tip === actual,
        updatedAt: r.updated_at,
      };
    });

    res.json({ settled });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
