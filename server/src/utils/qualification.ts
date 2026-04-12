export const TIP_ODDS_MIN = 1.50;
export const TIP_ODDS_MAX = 1.99;
export const OPPOSING_ODDS_MIN = 5.00;
export const MIN_PROBABILITY = 0.70;

export type Tip = '1' | 'X' | '2';

/**
 * The single source of truth for "is this match a qualifying pick".
 *
 * Rules:
 * - probability >= 0.70
 * - tipped-side odds in [1.50, 1.99] (inclusive)
 * - opposing side odds >= 5.00
 *   - For home tips (1), opposing = away_odds
 *   - For away tips (2), opposing = home_odds
 *   - For draw tips (X), opposing = min(home_odds, away_odds) — both must be >= 5.00
 *
 * Returns false if any odds value is null (cannot assess without data).
 */
export function qualifiesByOdds(
  tip: Tip,
  homeOdds: number | null,
  drawOdds: number | null,
  awayOdds: number | null,
  probability: number
): boolean {
  if (probability < MIN_PROBABILITY) return false;
  if (homeOdds == null || drawOdds == null || awayOdds == null) return false;

  let tipOdds: number;
  let opposingOdds: number;

  if (tip === '1') {
    tipOdds = homeOdds;
    opposingOdds = awayOdds;
  } else if (tip === '2') {
    tipOdds = awayOdds;
    opposingOdds = homeOdds;
  } else {
    tipOdds = drawOdds;
    opposingOdds = Math.min(homeOdds, awayOdds);
  }

  if (tipOdds < TIP_ODDS_MIN || tipOdds > TIP_ODDS_MAX) return false;
  if (opposingOdds < OPPOSING_ODDS_MIN) return false;
  return true;
}
