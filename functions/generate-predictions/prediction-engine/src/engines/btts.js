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
    cleanSheetRateHome,
    cleanSheetRateAway,
    bttsYesImpliedProb,
    bttsNoImpliedProb,
    h2hMatchCount,
  } = features;

  const reasonsYes = [];
  const reasonsNo = [];

  // Base score starting at neutral 50
  let yesScore = 50;

  // 1. Incorporate H2H BTTS rates (only when H2H matches exist)
  if (h2hMatchCount > 0) {
    yesScore += (bttsRateH2H - 0.5) * 30;
    if (bttsRateH2H >= 0.6) {
      reasonsYes.push(`High BTTS rate of ${Math.round(bttsRateH2H * 100)}% in historical head-to-head matches`);
    } else if (bttsRateH2H <= 0.35) {
      reasonsNo.push(`Low BTTS rate of ${Math.round(bttsRateH2H * 100)}% in historical head-to-head matches`);
    }
  }

  // 2. Incorporate recent match BTTS rate
  if (bttsRate > 0) {
    yesScore += (bttsRate - 0.5) * 22;
    if (bttsRate >= 0.6) {
      reasonsYes.push(`High BTTS rate of ${Math.round(bttsRate * 100)}% in recent outings`);
    } else if (bttsRate <= 0.35) {
      reasonsNo.push(`Low BTTS rate of ${Math.round(bttsRate * 100)}% in recent outings`);
    }
  }

  // 3. Goal averages and defensive clean sheet features
  const homeScored = avgGoalsScoredHome || 1.4;
  const awayScored = avgGoalsScoredAway || 1.1;
  const homeConceded = avgGoalsConcededHome || 1.1;
  const awayConceded = avgGoalsConcededAway || 1.4;

  if (homeScored >= 1.3 && awayScored >= 1.2) {
    yesScore += 14;
    reasonsYes.push(`Both teams score consistently (Home: ${homeScored}, Away: ${awayScored} goals/match)`);
  }
  if (homeConceded >= 1.2 && awayConceded >= 1.2) {
    yesScore += 10;
    reasonsYes.push(`Both sides show defensive vulnerabilities, conceding over 1.2 goals per match`);
  }

  // Clean sheet / failure to score signals
  if (cleanSheetRateHome >= 0.40 || cleanSheetRateAway >= 0.40) {
    yesScore -= 12;
    if (cleanSheetRateHome >= 0.40) reasonsNo.push(`Home team keeps clean sheets in ${Math.round(cleanSheetRateHome * 100)}% of matches`);
    if (cleanSheetRateAway >= 0.40) reasonsNo.push(`Away team keeps clean sheets in ${Math.round(cleanSheetRateAway * 100)}% of matches`);
  }
  if (failedToScoreRateHome >= 0.38 || failedToScoreRateAway >= 0.38) {
    yesScore -= 12;
    if (failedToScoreRateHome >= 0.38) reasonsNo.push(`Home team fails to score in ${Math.round(failedToScoreRateHome * 100)}% of matches`);
    if (failedToScoreRateAway >= 0.38) reasonsNo.push(`Away team fails to score in ${Math.round(failedToScoreRateAway * 100)}% of matches`);
  }

  // 4. Incorporate Bookmaker Implied Probabilities
  if (bttsYesImpliedProb) {
    yesScore = (yesScore * 0.45) + (bttsYesImpliedProb * 55);
    reasonsYes.push(`Bookmaker odds reflect a ${Math.round(bttsYesImpliedProb * 100)}% probability for BTTS Yes`);
  }
  if (bttsNoImpliedProb) {
    const impliedNoScore = (100 - yesScore) * 0.45 + (bttsNoImpliedProb * 55);
    yesScore = 100 - impliedNoScore;
    reasonsNo.push(`Bookmaker odds reflect a ${Math.round(bttsNoImpliedProb * 100)}% probability for BTTS No`);
  }

  // If H2H is unavailable and no strong signals, keep BTTS neutral (around 50)
  if (h2hMatchCount === 0 && Math.abs(yesScore - 50) < 10) {
    yesScore = 50 + (yesScore - 50) * 0.4;
  }

  // Cap score between 10 and 90
  yesScore = Math.max(10, Math.min(90, Math.round(yesScore)));
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
    bestReasons.push(`Historical scoring patterns and team profiles support this selection.`);
  }

  return {
    market: 'BTTS',
    selection: bestSelection,
    rawScore: bestScore,
    confidence: Number((bestScore / 100).toFixed(2)),
    reasons: bestReasons.slice(0, 3),
  };
}
