/**
 * Calculate expected value for a bet.
 * EV = (probability * odds) - 1
 * Positive EV means profitable in the long run.
 */
export function calculateEV(probability: number, odds: number): number {
  return probability * odds - 1;
}

/**
 * Convert decimal odds to implied probability.
 * impliedProb = 1 / odds
 */
export function impliedProbability(odds: number): number {
  return 1 / odds;
}

/**
 * Determine the tip based on probabilities.
 */
export function determineTip(homeProb: number, drawProb: number, awayProb: number): string {
  if (homeProb >= drawProb && homeProb >= awayProb) return '1';
  if (drawProb >= homeProb && drawProb >= awayProb) return 'X';
  return '2';
}
