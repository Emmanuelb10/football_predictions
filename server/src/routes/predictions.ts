import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as PredictionModel from '../models/Prediction';

dayjs.extend(utc);
dayjs.extend(timezone);
import { query } from '../config/database';
import { isValidDateString, LAUNCH_DATE } from '../utils/dateValidation';

const router = Router();

router.get('/pick-of-day', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const pick = await PredictionModel.findPickOfDay(date);
    res.json({ date, pick: pick || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ev-pick', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().tz('Africa/Nairobi').format('YYYY-MM-DD');
    if (!isValidDateString(date)) {
      res.status(400).json({ error: 'Invalid date', date });
      return;
    }
    const pick = await PredictionModel.findEvPick(date);
    res.json({ date, pick: pick || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POTD history: every day's pick with result
router.get('/potd-history', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') as date,
              TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH12:MI AM') as kickoff_time,
              ht.name as home_team, at2.name as away_team,
              t.name as tournament,
              p.tip, p.confidence, p.expected_value,
              p.potd_rank_score, p.reasoning,
              m.status, m.home_score, m.away_score,
              oh.home_odds, oh.draw_odds, oh.away_odds
       FROM predictions p
       JOIN matches m ON p.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       JOIN tournaments t ON m.tournament_id = t.id
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
       WHERE p.is_pick_of_day = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') >= $1
       ORDER BY m.kickoff DESC`,
      [LAUNCH_DATE]
    );

    // Build a map of POTD picks by date
    const picksByDate = new Map<string, any>();
    for (const r of result.rows) {
      const dateStr = dayjs(r.date).format('YYYY-MM-DD');
      const tipOdds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
      let outcome: 'pending' | 'won' | 'lost' = 'pending';
      if (r.status === 'finished') {
        const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
        outcome = r.tip === actual ? 'won' : 'lost';
      }
      picksByDate.set(dateStr, {
        date: dateStr,
        kickoffTime: r.kickoff_time || '',
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: tipOdds || 0,
        ev: Number(r.expected_value),
        score: r.status === 'finished' ? `${r.home_score}-${r.away_score}` : null,
        outcome,
        status: r.status,
        reasoning: r.reasoning || '',
        profit: outcome === 'won' ? +(tipOdds - 1).toFixed(2) : outcome === 'lost' ? -1 : 0,
      });
    }

    // Only include days that have a POTD pick (no filler "none" rows)
    const history = Array.from(picksByDate.values())
      .sort((a, b) => b.date.localeCompare(a.date));

    const withPicks = history.filter((h: any) => h.outcome !== 'none');
    const settled = withPicks.filter((h: any) => h.outcome === 'won' || h.outcome === 'lost');
    const wins = settled.filter((h: any) => h.outcome === 'won').length;
    const totalProfit = settled.reduce((sum: number, h: any) => sum + h.profit, 0);

    res.json({
      history,
      summary: {
        total: withPicks.length,
        settled: settled.length,
        wins,
        losses: settled.length - wins,
        hitRatio: settled.length > 0 ? +(wins / settled.length).toFixed(4) : 0,
        totalProfit: +totalProfit.toFixed(2),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/ev-pick-history', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') as date,
              TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH12:MI AM') as kickoff_time,
              ht.name as home_team, at2.name as away_team,
              t.name as tournament,
              p.tip, p.confidence, p.expected_value,
              p.potd_rank_score, p.reasoning,
              m.status, m.home_score, m.away_score,
              oh.home_odds, oh.draw_odds, oh.away_odds
       FROM predictions p
       JOIN matches m ON p.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       JOIN tournaments t ON m.tournament_id = t.id
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
       WHERE p.is_ev_pick = true AND DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') >= $1
       ORDER BY m.kickoff DESC`,
      [LAUNCH_DATE]
    );

    const picksByDate = new Map<string, any>();
    for (const r of result.rows) {
      const dateStr = dayjs(r.date).format('YYYY-MM-DD');
      const tipOdds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
      let outcome: 'pending' | 'won' | 'lost' = 'pending';
      if (r.status === 'finished') {
        const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
        outcome = r.tip === actual ? 'won' : 'lost';
      }
      picksByDate.set(dateStr, {
        date: dateStr,
        kickoffTime: r.kickoff_time || '',
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: tipOdds || 0,
        ev: Number(r.expected_value),
        score: r.status === 'finished' ? `${r.home_score}-${r.away_score}` : null,
        outcome,
        status: r.status,
        reasoning: r.reasoning || '',
        profit: outcome === 'won' ? +(tipOdds - 1).toFixed(2) : outcome === 'lost' ? -1 : 0,
      });
    }

    const history = Array.from(picksByDate.values())
      .sort((a, b) => b.date.localeCompare(a.date));

    const withPicks = history.filter((h: any) => h.outcome !== 'none');
    const settled = withPicks.filter((h: any) => h.outcome === 'won' || h.outcome === 'lost');
    const wins = settled.filter((h: any) => h.outcome === 'won').length;
    const totalProfit = settled.reduce((sum: number, h: any) => sum + h.profit, 0);

    res.json({
      history,
      summary: {
        total: withPicks.length,
        settled: settled.length,
        wins,
        losses: settled.length - wins,
        hitRatio: settled.length > 0 ? +(wins / settled.length).toFixed(4) : 0,
        totalProfit: +totalProfit.toFixed(2),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
