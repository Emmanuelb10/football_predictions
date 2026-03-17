import { Router, Request, Response } from 'express';
import dayjs from 'dayjs';
import * as PredictionModel from '../models/Prediction';
import { query } from '../config/database';

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

// Accumulator builder: suggest 2-fold, 3-fold combos from value bets
router.get('/accumulators', async (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || dayjs().format('YYYY-MM-DD');

    const result = await query(
      `SELECT p.match_id, p.tip, p.confidence, p.expected_value,
              ht.name as home_team, at2.name as away_team, t.name as tournament,
              oh.home_odds, oh.draw_odds, oh.away_odds
       FROM predictions p
       JOIN matches m ON p.match_id = m.id
       JOIN teams ht ON m.home_team_id = ht.id
       JOIN teams at2 ON m.away_team_id = at2.id
       JOIN tournaments t ON m.tournament_id = t.id
       LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC LIMIT 1) oh ON true
       WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'UTC') = $1
       ORDER BY p.confidence DESC`,
      [date]
    );

    const picks = result.rows.map((r: any) => {
      const odds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
      return {
        matchId: r.match_id,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: odds || 1.8,
      };
    });

    if (picks.length < 2) {
      res.json({ date, accumulators: [] });
      return;
    }

    const accumulators: any[] = [];

    // Generate 2-fold and 3-fold combos
    for (let size = 2; size <= Math.min(4, picks.length); size++) {
      const combos = getCombinations(picks, size);
      for (const combo of combos) {
        const combinedOdds = combo.reduce((acc: number, p: any) => acc * p.odds, 1);
        const combinedProb = combo.reduce((acc: number, p: any) => acc * p.confidence, 1);
        const combinedEV = combinedProb * combinedOdds - 1;
        const leagues = new Set(combo.map((p: any) => p.tournament));
        const diversityScore = leagues.size / combo.length;

        accumulators.push({
          picks: combo,
          size,
          combinedOdds: +combinedOdds.toFixed(2),
          combinedProb: +combinedProb.toFixed(4),
          combinedEV: +combinedEV.toFixed(4),
          diversityScore: +diversityScore.toFixed(2),
        });
      }
    }

    // Sort by combined EV, take top 5
    accumulators.sort((a, b) => b.combinedEV - a.combinedEV);
    res.json({ date, accumulators: accumulators.slice(0, 5) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function getCombinations(arr: any[], size: number): any[][] {
  if (size === 1) return arr.map(x => [x]);
  const result: any[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1);
    for (const combo of rest) {
      result.push([arr[i], ...combo]);
    }
  }
  return result;
}

export default router;
