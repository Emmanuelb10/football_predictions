/**
 * Poisson distribution for football score modeling.
 * P(X = k) = (lambda^k * e^(-lambda)) / k!
 */
function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonPmf(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calculate match outcome probabilities using Poisson distribution.
 * @param homeExpGoals Expected goals for home team (xG)
 * @param awayExpGoals Expected goals for away team (xG)
 * @param maxGoals Maximum goals to consider per team
 */
export function poissonMatchProbs(homeExpGoals: number, awayExpGoals: number, maxGoals = 6) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const prob = poissonPmf(homeExpGoals, h) * poissonPmf(awayExpGoals, a);
      if (h > a) homeWin += prob;
      else if (h === a) draw += prob;
      else awayWin += prob;
    }
  }

  return { homeWin, draw, awayWin };
}

/**
 * Calculate a "Poisson agreement score" — how much the Poisson model
 * agrees with the AI prediction. Higher = more agreement.
 */
export function poissonAgreementScore(
  aiProbs: { home: number; draw: number; away: number },
  poissonProbs: { homeWin: number; draw: number; awayWin: number }
): number {
  // Cosine similarity between the two probability vectors
  const dot =
    aiProbs.home * poissonProbs.homeWin +
    aiProbs.draw * poissonProbs.draw +
    aiProbs.away * poissonProbs.awayWin;

  const magA = Math.sqrt(aiProbs.home ** 2 + aiProbs.draw ** 2 + aiProbs.away ** 2);
  const magP = Math.sqrt(poissonProbs.homeWin ** 2 + poissonProbs.draw ** 2 + poissonProbs.awayWin ** 2);

  return magA && magP ? dot / (magA * magP) : 0;
}
