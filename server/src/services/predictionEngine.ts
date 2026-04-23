import { query } from '../config/database';
import logger from '../config/logger';
import * as PredictionModel from '../models/Prediction';
import * as OddsModel from '../models/OddsHistory';
import { calculateEV } from '../utils/expectedValue';
import { qualifiesByOdds, type Tip } from '../utils/qualification';
import { poissonMatchProbs, poissonAgreementScore } from '../utils/poisson';

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

export async function processPrediction(
  matchId: number,
  matchInfo: MatchInfo,
  matchApiId: number,
  precomputed?: PredictionInput,
  source: string = 'scraped'
) {
  try {
    if (!precomputed) {
      logger.warn(`No prediction for match ${matchApiId} (${matchInfo.homeTeam} vs ${matchInfo.awayTeam})`);
      return null;
    }
    return await storePrediction(matchId, precomputed, matchApiId, source);
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
    valueBet = qualifiesByOdds(
      tip as Tip,
      odds.home_odds != null ? Number(odds.home_odds) : null,
      odds.draw_odds != null ? Number(odds.draw_odds) : null,
      odds.away_odds != null ? Number(odds.away_odds) : null,
      confidence,
    );
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
    `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
            TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
     WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  // Post-filter in JS using the shared qualifier. This catches stale is_value_bet
  // flags and any edge case the SQL filter alone cannot express.
  const candidates = res.rows.filter((c: any) => qualifiesByOdds(
    c.tip as Tip,
    c.home_odds != null ? Number(c.home_odds) : null,
    c.draw_odds != null ? Number(c.draw_odds) : null,
    c.away_odds != null ? Number(c.away_odds) : null,
    Number(c.confidence),
  ));

  if (candidates.length === 0) {
    logger.info(`No qualifying picks for ${date}`);
    await PredictionModel.clearPickOfDay(date);
    return null;
  }

  await PredictionModel.clearPickOfDay(date);

  // Pick of the Day: highest EV wins.
  // Sort by expected value descending; ties broken by confidence.
  const scored = candidates.map((vb: any) => {
    const ev = Number(vb.expected_value) || 0;
    const tipOdds = vb.tip === '1' ? Number(vb.home_odds) :
                    vb.tip === 'X' ? Number(vb.draw_odds) : Number(vb.away_odds);
    return { ...vb, potdScore: ev, tipOdds };
  });

  scored.sort((a: any, b: any) => {
    if (b.potdScore !== a.potdScore) return b.potdScore - a.potdScore;
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });
  const winner = scored[0];

  const tipLabel = winner.tip === '1' ? 'Home Win' : winner.tip === '2' ? 'Away Win' : 'Draw';
  const reasoning = `${winner.home_team} vs ${winner.away_team}: ${tipLabel} at ${(Number(winner.confidence) * 100).toFixed(0)}% confidence, odds ${winner.tipOdds?.toFixed(2) || 'N/A'}. ` +
    `EV: ${Number(winner.expected_value) > 0 ? '+' : ''}${(Number(winner.expected_value) * 100).toFixed(1)}%, ` +
    `Poisson: ${(Number(winner.poisson_score) * 100).toFixed(0)}%. ` +
    `Highest EV from ${scored.length} qualifying matches.`;

  for (const s of scored) {
    const isPotd = s.id === winner.id;
    await query(
      'UPDATE predictions SET potd_rank_score=$1, is_pick_of_day=$2, reasoning=$3 WHERE id=$4',
      [s.potdScore, isPotd, isPotd ? reasoning : '', s.id]
    );
  }

  logger.info(`Pick of the Day for ${date}: ${winner.home_team} vs ${winner.away_team} (EV: ${(winner.potdScore * 100).toFixed(1)}%)`);
  return winner;
}

export async function selectEvPick(date: string) {
  const res = await query(
    `SELECT p.*, ht.name as home_team, at2.name as away_team, t.name as league,
            TO_CHAR(m.kickoff AT TIME ZONE 'Africa/Nairobi', 'HH24:MI') as kickoff_time,
            oh.home_odds, oh.draw_odds, oh.away_odds
     FROM predictions p
     JOIN matches m ON p.match_id = m.id
     JOIN teams ht ON m.home_team_id = ht.id
     JOIN teams at2 ON m.away_team_id = at2.id
     JOIN tournaments t ON m.tournament_id = t.id
     LEFT JOIN LATERAL (SELECT * FROM odds_history WHERE match_id = m.id ORDER BY scraped_at DESC, id DESC LIMIT 1) oh ON true
     WHERE DATE(m.kickoff AT TIME ZONE 'Africa/Nairobi') = $1`,
    [date]
  );

  // Same candidate pool as POTD: must pass qualifiesByOdds
  const qualified = res.rows.filter((c: any) => qualifiesByOdds(
    c.tip as Tip,
    c.home_odds != null ? Number(c.home_odds) : null,
    c.draw_odds != null ? Number(c.draw_odds) : null,
    c.away_odds != null ? Number(c.away_odds) : null,
    Number(c.confidence),
  ));

  // Additional filter: EV > 20%
  const candidates = qualified.filter((c: any) => Number(c.expected_value) >= 0.20);

  await PredictionModel.clearEvPick(date);

  if (candidates.length === 0) {
    logger.info(`No EV pick candidates (EV >= 20%) for ${date}`);
    return null;
  }

  // Sort by EV descending, tiebreak by confidence
  candidates.sort((a: any, b: any) => {
    const evDiff = Number(b.expected_value) - Number(a.expected_value);
    if (evDiff !== 0) return evDiff;
    return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
  });

  const winner = candidates[0];
  const tipOdds = winner.tip === '1' ? Number(winner.home_odds) :
                  winner.tip === 'X' ? Number(winner.draw_odds) : Number(winner.away_odds);
  const tipLabel = winner.tip === '1' ? 'Home Win' : winner.tip === '2' ? 'Away Win' : 'Draw';
  const reasoning = `${winner.home_team} vs ${winner.away_team}: ${tipLabel} at ${(Number(winner.confidence) * 100).toFixed(0)}% confidence, odds ${tipOdds?.toFixed(2) || 'N/A'}. ` +
    `EV: ${Number(winner.expected_value) > 0 ? '+' : ''}${(Number(winner.expected_value) * 100).toFixed(1)}%. ` +
    `Selected as EV Pick: highest expected value (${(Number(winner.expected_value) * 100).toFixed(1)}%) from ${candidates.length} candidates with EV above 20%.`;

  await query(
    'UPDATE predictions SET is_ev_pick = true, reasoning = CASE WHEN reasoning = $2 OR reasoning = \'\' THEN $2 ELSE reasoning END WHERE id = $1',
    [winner.id, reasoning]
  );

  logger.info(`EV Pick for ${date}: ${winner.home_team} vs ${winner.away_team} (EV: ${(Number(winner.expected_value) * 100).toFixed(1)}%)`);
  return winner;
}
