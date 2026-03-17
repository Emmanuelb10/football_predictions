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
              m.status, m.home_score, m.away_score,
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
      let pickResult: 'pending' | 'won' | 'lost' = 'pending';
      if (r.status === 'finished') {
        const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
        pickResult = r.tip === actual ? 'won' : 'lost';
      }
      return {
        matchId: r.match_id,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: odds || 1.8,
        result: pickResult,
        score: r.status === 'finished' ? `${r.home_score}-${r.away_score}` : null,
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

        // Determine accumulator result: won only if ALL legs won
        const allSettled = combo.every((p: any) => p.result !== 'pending');
        const allWon = combo.every((p: any) => p.result === 'won');
        const anyLost = combo.some((p: any) => p.result === 'lost');
        const accResult: 'pending' | 'won' | 'lost' = anyLost ? 'lost' : allSettled && allWon ? 'won' : 'pending';
        const payout = accResult === 'won' ? +combinedOdds.toFixed(2) : accResult === 'lost' ? -1 : 0;

        accumulators.push({
          picks: combo,
          size,
          combinedOdds: +combinedOdds.toFixed(2),
          combinedProb: +combinedProb.toFixed(4),
          combinedEV: +combinedEV.toFixed(4),
          diversityScore: +diversityScore.toFixed(2),
          result: accResult,
          payout,
        });
      }
    }

    // Pick the BEST accumulator per size (2-fold, 3-fold, 4-fold)
    // Sort each size by EV, take only the top one per size
    accumulators.sort((a, b) => b.combinedEV - a.combinedEV);

    const bestPerSize: any[] = [];
    const usedSizes = new Set<number>();
    for (const acc of accumulators) {
      if (!usedSizes.has(acc.size)) {
        usedSizes.add(acc.size);
        bestPerSize.push(acc);
      }
      if (bestPerSize.length >= 3) break;
    }

    // Sort final output: 2-fold, 3-fold, 4-fold
    bestPerSize.sort((a, b) => a.size - b.size);
    res.json({ date, accumulators: bestPerSize });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POTD history: every day's pick with result
router.get('/potd-history', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await query(
      `SELECT DATE(m.kickoff AT TIME ZONE 'UTC') as date,
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
       WHERE p.is_pick_of_day = true
       ORDER BY m.kickoff DESC
       LIMIT $1`,
      [days]
    );

    const history = result.rows.map((r: any) => {
      const tipOdds = r.tip === '1' ? Number(r.home_odds) : r.tip === 'X' ? Number(r.draw_odds) : Number(r.away_odds);
      let outcome: 'pending' | 'won' | 'lost' = 'pending';
      if (r.status === 'finished') {
        const actual = r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X';
        outcome = r.tip === actual ? 'won' : 'lost';
      }
      return {
        date: r.date,
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        tournament: r.tournament,
        tip: r.tip,
        confidence: Number(r.confidence),
        odds: tipOdds || 0,
        ev: Number(r.expected_value),
        score: r.status === 'finished' ? `${r.home_score}-${r.away_score}` : null,
        outcome,
        reasoning: r.reasoning || '',
        profit: outcome === 'won' ? +(tipOdds - 1).toFixed(2) : outcome === 'lost' ? -1 : 0,
      };
    });

    const settled = history.filter((h: any) => h.outcome !== 'pending');
    const wins = settled.filter((h: any) => h.outcome === 'won').length;
    const totalProfit = settled.reduce((sum: number, h: any) => sum + h.profit, 0);

    res.json({
      history,
      summary: {
        total: history.length,
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
