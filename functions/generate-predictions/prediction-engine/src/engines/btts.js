/**
 * Both Teams To Score (BTTS) Market Engine.
 * Predicts: Yes, No
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictBTTS(features) {
  const {
    bttsRate,
    bttsRateH2H,
    avgGoalsScoredHome,
    avgGoalsScoredAway,
    avgGoalsConcededHome,
    avgGoalsConcededAway,
    failedToScoreRateHome,
    failedToScoreRateAway,
    bttsYesImpliedProb,
    bttsNoImpliedProb,
  } = features;

  const reasonsYes = [];
  const reasonsNo = [];

  // Base score starting at neutral 50
  let yesScore = 50;

  // 1. Incorporate H2H and overall BTTS rates
  yesScore += (bttsRateH2H - 0.5) * 30; // H2H BTTS rate impact
  if (bttsRateH2H > 0.6) {
    reasonsYes.push(`High BTTS rate of ${Math.round(bttsRateH2H * 100)}% in historical head-to-head matches`);
  } else if (bttsRateH2H < 0.4 && bttsRateH2H > 0) {
    reasonsNo.push(`Low BTTS rate of ${Math.round(bttsRateH2H * 100)}% in historical head-to-head matches`);
  }

  yesScore += (bttsRate - 0.5) * 20; // Overall BTTS rate impact
  if (bttsRate > 0.6) {
    reasonsYes.push(`High BTTS rate of ${Math.round(bttsRate * 100)}% in recent matches`);
  } else if (bttsRate < 0.4 && bttsRate > 0) {
    reasonsNo.push(`Low BTTS rate of ${Math.round(bttsRate * 100)}% in recent matches`);
  }

  // 2. Goal averages and defensive clean sheet features
  if (avgGoalsScoredHome > 1.2 && avgGoalsScoredAway > 1.2) {
    yesScore += 15;
    reasonsYes.push(`Both teams score consistently (Home: ${avgGoalsScoredHome}, Away: ${avgGoalsScoredAway} goals/match)`);
  }
  if (avgGoalsConcededHome > 1.1 && avgGoalsConcededAway > 1.1) {
    yesScore += 10;
    reasonsYes.push(`Both sides show defensive vulnerabilities, conceding over 1.1 goals per match`);
  }
  if (failedToScoreRateHome > 0.35 || failedToScoreRateAway > 0.35) {
    yesScore -= 15;
    if (failedToScoreRateHome > 0.35) reasonsNo.push(`Home team fails to score in ${Math.round(failedToScoreRateHome * 100)}% of matches`);
    if (failedToScoreRateAway > 0.35) reasonsNo.push(`Away team fails to score in ${Math.round(failedToScoreRateAway * 100)}% of matches`);
  }

  // 3. Incorporate Bookmaker Implied Probabilities
  if (bttsYesImpliedProb) {
    yesScore = (yesScore * 0.4) + (bttsYesImpliedProb * 60);
    reasonsYes.push(`Bookmaker odds reflect a ${Math.round(bttsYesImpliedProb * 100)}% probability for BTTS Yes`);
  }
  if (bttsNoImpliedProb) {
    const impliedNoScore = (100 - yesScore) * 0.4 + (bttsNoImpliedProb * 60);
    yesScore = 100 - impliedNoScore;
    reasonsNo.push(`Bookmaker odds reflect a ${Math.round(bttsNoImpliedProb * 100)}% probability for BTTS No`);
  }

  // Cap score between 0 and 100
  yesScore = Math.max(0, Math.min(100, Math.round(yesScore)));
  const noScore = 100 - yesScore;

  let bestSelection = 'Yes';
  let bestScore = yesScore;
  let bestReasons = reasonsYes;

  if (noScore > yesScore) {
    bestSelection = 'No';
    bestScore = noScore;
    bestReasons = reasonsNo;
  }

  if (bestReasons.length === 0) {
    bestReasons.push(`Historical scoring patterns support this selection.`);
  }

  return {
    market: 'BTTS',
    selection: bestSelection,
    rawScore: bestScore,
    confidence: Number((bestScore / 100).toFixed(2)),
    reasons: bestReasons.slice(0, 3),
  };
}
