/**
 * Calculate standard deviation of an array of numbers.
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Min-max normalization to [0, 1].
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Compute composite POTD rank score.
 * Weights: EV 30%, Hit Ratio 25%, Consistency 20%, Poisson 15%, Line Movement 10%
 */
export function computePotdScore(metrics: {
  ev: number;
  hitRatio: number;
  consistency: number; // 1/stdDev, already inverted
  poissonScore: number;
  lineMovement: number;
  allCandidates: Array<{
    ev: number;
    hitRatio: number;
    consistency: number;
    poissonScore: number;
    lineMovement: number;
  }>;
}): number {
  const { ev, hitRatio, consistency, poissonScore, lineMovement, allCandidates } = metrics;

  const getRange = (key: keyof (typeof allCandidates)[0]) => {
    const values = allCandidates.map((c) => c[key]);
    return { min: Math.min(...values), max: Math.max(...values) };
  };

  const evRange = getRange('ev');
  const hrRange = getRange('hitRatio');
  const conRange = getRange('consistency');
  const psRange = getRange('poissonScore');
  const lmRange = getRange('lineMovement');

  return (
    0.30 * normalize(ev, evRange.min, evRange.max) +
    0.25 * normalize(hitRatio, hrRange.min, hrRange.max) +
    0.20 * normalize(consistency, conRange.min, conRange.max) +
    0.15 * normalize(poissonScore, psRange.min, psRange.max) +
    0.10 * normalize(lineMovement, lmRange.min, lmRange.max)
  );
}
