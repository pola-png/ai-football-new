/**
 * Double Chance Market Engine.
 * Predicts: 1X, X2, 12
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictDoubleChance(features) {
  const {
    homeFormScore,
    awayFormScore,
    strengthRatio,
    strengthDifference,
    homeImpliedProb,
    awayImpliedProb,
    drawImpliedProb,
    homeWinRateH2H,
    awayWinRateH2H,
    drawRateH2H,
  } = features;

  // 1. Calculate base win/draw/loss probabilities
  let pHome = homeImpliedProb || (0.35 + strengthRatio * 0.3);
  let pAway = awayImpliedProb || (0.28 + (1 - strengthRatio) * 0.3);
  let pDraw = drawImpliedProb || 0.25;

  const total = pHome + pAway + pDraw;
  pHome /= total;
  pAway /= total;
  pDraw /= total;

  // 2. Score selections (max 100)
  let score1X = (pHome + pDraw) * 100;
  let scoreX2 = (pAway + pDraw) * 100;
  let score12 = (pHome + pAway) * 100;

  const reasons1X = [];
  const reasonsX2 = [];
  const reasons12 = [];

  // Form adjustments
  const formDiff = homeFormScore - awayFormScore;
  score1X += formDiff * 0.1;
  scoreX2 -= formDiff * 0.1;

  if (homeFormScore > 60) {
    reasons1X.push(`Home team has strong recent form, undefeated in recent matches (form score ${homeFormScore}%)`);
  }
  if (awayFormScore > 60) {
    reasonsX2.push(`Away team has strong recent form, undefeated in recent matches (form score ${awayFormScore}%)`);
  }

  // Elo adjustment
  if (strengthDifference > 80) {
    score1X += 8;
    reasons1X.push(`Home team carries a clear Elo strength advantage (+${strengthDifference})`);
  } else if (strengthDifference < -80) {
    scoreX2 += 8;
    reasonsX2.push(`Away team carries a clear Elo strength advantage (+${Math.abs(strengthDifference)})`);
  }

  // Draw rate adjustment for 12 (no draw)
  if (drawRateH2H < 0.15 && drawRateH2H > 0) {
    score12 += 10;
    reasons12.push(`Low historical H2H draw rate (${Math.round(drawRateH2H * 100)}%) favors a decisive outcome`);
  }
  if (pDraw < 0.20) {
    score12 += 5;
  }

  // Cap scores
  score1X = Math.max(0, Math.min(100, Math.round(score1X)));
  scoreX2 = Math.max(0, Math.min(100, Math.round(scoreX2)));
  score12 = Math.max(0, Math.min(100, Math.round(score12)));

  // Select the highest score
  let bestSelection = '1X';
  let bestScore = score1X;
  let bestReasons = reasons1X;

  if (scoreX2 > bestScore) {
    bestSelection = 'X2';
    bestScore = scoreX2;
    bestReasons = reasonsX2;
  }
  if (score12 > bestScore) {
    bestSelection = '12';
    bestScore = score12;
    bestReasons = reasons12;
  }

  if (bestReasons.length === 0) {
    bestReasons.push(`Covering multiple match outcomes based on relative strength metrics.`);
  }

  return {
    market: 'Double Chance',
    selection: bestSelection,
    rawScore: bestScore,
    confidence: Number((bestScore / 100).toFixed(2)),
    reasons: bestReasons.slice(0, 3),
  };
}
