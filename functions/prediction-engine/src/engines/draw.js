/**
 * Draw Market Engine.
 * Predicts: Yes, No
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictDraw(features) {
  const {
    homeFormScore,
    awayFormScore,
    strengthDifference,
    rankDifference,
    drawImpliedProb,
    drawRateH2H,
  } = features;

  const reasonsYes = [];
  const reasonsNo = [];

  // Base score starting at neutral 45
  let yesScore = 45;

  // 1. Evaluate Elo differences (closer Elo = higher draw chance)
  const absStrengthDiff = Math.abs(strengthDifference);
  if (absStrengthDiff < 50) {
    yesScore += 15;
    reasonsYes.push(`Highly matched teams in terms of Elo strength (difference: ${absStrengthDiff} points)`);
  } else if (absStrengthDiff > 150) {
    yesScore -= 20;
    reasonsNo.push(`Significant Elo strength gap of ${absStrengthDiff} points suggests a decisive outcome`);
  }

  // 2. Evaluate Form similarity (similar form = higher draw chance)
  const absFormDiff = Math.abs(homeFormScore - awayFormScore);
  if (absFormDiff < 8) {
    yesScore += 10;
  } else if (absFormDiff > 25) {
    yesScore -= 15;
    reasonsNo.push(`Form discrepancy of ${absFormDiff}% indicates one team has a strong competitive edge`);
  }

  // 3. Evaluate H2H Draw rate
  if (drawRateH2H > 0.35) {
    yesScore += 15;
    reasonsYes.push(`High historical H2H draw rate of ${Math.round(drawRateH2H * 100)}%`);
  } else if (drawRateH2H < 0.15 && drawRateH2H > 0) {
    yesScore -= 10;
    reasonsNo.push(`Low historical H2H draw rate of ${Math.round(drawRateH2H * 100)}%`);
  }

  // 4. Incorporate Bookmaker Implied Probabilities
  if (drawImpliedProb) {
    yesScore = (yesScore * 0.4) + (drawImpliedProb * 60);
    reasonsYes.push(`Bookmaker draw odds reflect a ${Math.round(drawImpliedProb * 100)}% implied probability`);
  }

  // Cap score
  yesScore = Math.max(0, Math.min(100, Math.round(yesScore)));
  const noScore = 100 - yesScore;

  let bestSelection = 'No';
  let bestScore = noScore;
  let bestReasons = reasonsNo;

  if (yesScore > noScore) {
    bestSelection = 'Yes';
    bestScore = yesScore;
    bestReasons = reasonsYes;
  }

  if (bestReasons.length === 0) {
    bestReasons.push(`Evaluated from team form variance and competitive ratings.`);
  }

  return {
    market: 'Draw',
    selection: bestSelection,
    rawScore: bestScore,
    confidence: Number((bestScore / 100).toFixed(2)),
    reasons: bestReasons.slice(0, 3),
  };
}
