/**
 * Corners Market Engine (Optional/Specialized).
 * Predicts: Over 8.5, Under 10.5
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictCorners(features) {
  const { avgCorners } = features;

  const reasons = [];
  let selection = 'Over 8.5';
  let score = 55;

  if (avgCorners > 9.5) {
    selection = 'Over 8.5';
    score += (avgCorners - 8.5) * 12;
    reasons.push(`Teams average a combined ${avgCorners.toFixed(1)} corners per match, supporting the Over 8.5 line`);
  } else {
    selection = 'Under 10.5';
    score += (10.5 - avgCorners) * 12;
    reasons.push(`Low corner statistics (average ${avgCorners.toFixed(1)} corners/match) suggest Under 10.5 corners`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    market: 'Corners',
    selection,
    rawScore: score,
    confidence: Number((score / 100).toFixed(2)),
    reasons: reasons.slice(0, 3),
  };
}
