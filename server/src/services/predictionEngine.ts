import { query } from '../config/database';
import logger from '../config/logger';
import * as PredictionModel from '../models/Prediction';
import * as OddsModel from '../models/OddsHistory';
import { calculateEV, isValueBet } from '../utils/expectedValue';
import { poissonMatchProbs, poissonAgreementScore } from '../utils/poisson';
import { computePotdScore } from '../utils/stats';

interface MatchInfo {
  homeTeam: string;
  awayTeam: string;
  league: string;
  country: string;
  kickoff: string;
}

interface PredictionInput {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  confidence: number;
  tip: string;
  reasoning: string;
}

export async function processAIPrediction(
  matchId: number,
  matchInfo: MatchInfo,
  matchApiId: number,
  precomputed?: PredictionInput
) {
  try {
    if (!precomputed) {
      logger.warn(`No prediction for match ${matchApiId} (${matchInfo.homeTeam} vs ${matchInfo.awayTeam})`);
      return null;
    }
    return await storePrediction(matchId, precomputed, matchApiId, 'claude');
  } catch (error: any) {
    logger.error(`Failed to store prediction for match ${matchApiId}: ${error.message}`);
    return null;
  }
}

async function storePrediction(matchId: number, pred: PredictionInput, matchApiId: number, source: string) {
  const { homeWinProb, drawProb, awayWinProb, tip, confidence } = pred;

  const odds = await OddsModel.getLatestOdds(matchId);
  let ev = 0;
  let valueBet = false;

  if (odds) {
    const tipOdds =
      tip === '1' ? Number(odds.home_odds) :
      tip === 'X' ? Number(odds.draw_odds) :
      Number(odds.away_odds);
    ev = calculateEV(confidence, tipOdds);
    valueBet = isValueBet(confidence, tipOdds);
  }

  const poissonScore = computePoissonFromProbs(homeWinProb, drawProb, awayWinProb);
  const leagueHitRatio = await getLeagueHitRatio(matchId);

  const prediction = await PredictionModel.upsert({
    match_id: matchId,
    home_win_prob: homeWinProb,
    draw_prob: drawProb,
    away_win_prob: awayWinProb,
    tip, confidence,
    expected_value: ev,
    is_value_bet: valueBet,
    poisson_score: poissonScore,
    league_hit_ratio: leagueHitRatio,
    source,
    reasoning: pred.reasoning || '',
  });

  logger.info(`Prediction [${source}] match ${matchApiId}: tip=${tip}, conf=${(confidence * 100).toFixed(1)}%, ev=${ev.toFixed(4)}, value=${valueBet}`);
  return prediction;
}

function computePoissonFromProbs(homeProb: number, drawProb: number, awayProb: number): number {
  const homeXG = 0.8 + homeProb * 1.5;
  const awayXG = 0.8 + awayProb * 1.5;
  const pProbs = poissonMatchProbs(homeXG, awayXG);
  return poissonAgreementScore({ home: homeProb, draw: drawProb, away: awayProb }, pProbs);
}

async function getLeagueHitRatio(matchId: number): Promise<number> {
  try {
    const res = await query(
      `SELECT COUNT(*) FILTER (WHERE
          (p.tip = '1' AND m2.home_score > m2.away_score) OR
          (p.tip = '2' AND m2.away_score > m2.home_score) OR
          (p.tip = 'X' AND m2.home_score = m2.away_score)
        )::float / NULLIF(COUNT(*), 0) as hit_ratio
       FROM predictions p JOIN matches m2 ON p.match_id = m2.id
       WHERE m2.tournament_id = (SELECT tournament_id FROM matches WHERE id = $1)
         AND m2.status = 'finished' AND p.is_value_bet = true`,
      [matchId]
    );
    return res.rows[0]?.hit_ratio || 0.5;
  } catch {
    return 0.5;
  }
}

export async function selectPickOfDay(date: string) {
  const res = await query(
    `SELECT p.* FROM predictions p JOIN matches m ON p.match_id = m.id
     WHERE p.is_value_bet = true AND DATE(m.kickoff AT TIME ZONE 'UTC') = $1`,
    [date]
  );
  const valueBets = res.rows;

  if (valueBets.length === 0) {
    logger.info(`No value bets for ${date}`);
    return null;
  }

  await PredictionModel.clearPickOfDay(date);

  if (valueBets.length === 1) {
    const vb = valueBets[0];
    const det = await query(
      `SELECT ht.name as home, at2.name as away, t.name as league
       FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
       JOIN tournaments t ON m.tournament_id=t.id WHERE m.id=$1`, [vb.match_id]
    );
    const info = det.rows[0];
    const tipL = vb.tip === '1' ? 'Home Win' : vb.tip === '2' ? 'Away Win' : 'Draw';
    const reason = info
      ? `${info.home} vs ${info.away} (${info.league}): ${tipL} at ${(Number(vb.confidence)*100).toFixed(0)}% confidence. ` +
        `EV: ${Number(vb.expected_value) > 0 ? '+' : ''}${(Number(vb.expected_value)*100).toFixed(1)}%. ` +
        `Only qualifying value bet for the day.`
      : '';
    await query('UPDATE predictions SET is_pick_of_day=true, potd_rank_score=1, reasoning=$1 WHERE id=$2', [reason, vb.id]);
    return vb;
  }

  const candidates = await Promise.all(
    valueBets.map(async (vb) => {
      const lm = await OddsModel.getLineMovement(vb.match_id);
      const tipMovement = typeof lm === 'number' ? 0 :
        vb.tip === '1' ? lm.home : vb.tip === 'X' ? lm.draw : lm.away;
      return {
        ...vb,
        ev: Number(vb.expected_value),
        hitRatio: Number(vb.league_hit_ratio) || 0.5,
        consistency: vb.std_deviation ? 1 / Math.max(Number(vb.std_deviation), 0.01) : 1,
        poissonScore: Number(vb.poisson_score) || 0.5,
        lineMovement: tipMovement || 0,
      };
    })
  );

  const scored = candidates.map((c) => ({
    ...c,
    potdScore: computePotdScore({
      ev: c.ev, hitRatio: c.hitRatio, consistency: c.consistency,
      poissonScore: c.poissonScore, lineMovement: c.lineMovement,
      allCandidates: candidates,
    }),
  }));

  scored.sort((a, b) => b.potdScore - a.potdScore);
  const winner = scored[0];

  // Get winner team names for reasoning
  const detailRes = await query(
    `SELECT ht.name as home, at2.name as away, t.name as league
     FROM matches m JOIN teams ht ON m.home_team_id=ht.id JOIN teams at2 ON m.away_team_id=at2.id
     JOIN tournaments t ON m.tournament_id=t.id WHERE m.id=$1`,
    [winner.match_id]
  );
  const det = detailRes.rows[0];
  const tipLabel = winner.tip === '1' ? 'Home Win' : winner.tip === '2' ? 'Away Win' : 'Draw';
  let potdReason = '';
  if (det) {
    potdReason = `${tipLabel} at ${(Number(winner.confidence) * 100).toFixed(0)}% confidence. ` +
      `EV: ${winner.ev > 0 ? '+' : ''}${(winner.ev * 100).toFixed(1)}%. ` +
      `Ranked #1 of ${scored.length} value bets (score: ${winner.potdScore.toFixed(3)}) ` +
      `based on expected value, league reliability, team consistency, and Poisson model agreement.`;
  }
  logger.info(`POTD reasoning: ${potdReason}`);

  for (const s of scored) {
    const isPotd = s.id === winner.id;
    await query(
      'UPDATE predictions SET potd_rank_score=$1, is_pick_of_day=$2, line_movement=$3, reasoning=$4 WHERE id=$5',
      [s.potdScore, isPotd, s.lineMovement, isPotd ? potdReason : '', s.id]
    );
  }

  logger.info(`Pick of the Day for ${date}: id=${winner.id}, score=${winner.potdScore.toFixed(4)}`);
  return winner;
}
