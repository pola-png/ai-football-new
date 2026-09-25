/**
 * Over/Under Goals Market Engine.
 * Predicts: Over 1.5, Over 2.5, Under 2.5, Under 3.5, Over 3.5
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictOverUnder(features) {
  const {
    over15Rate,
    over25Rate,
    under25Rate,
    over15RateH2H,
    over25RateH2H,
    avgGoalsScoredHome,
    avgGoalsScoredAway,
    avgGoalsConcededHome,
    avgGoalsConcededAway,
    avgGoalsH2H,
    over25ImpliedProb,
    under25ImpliedProb,
    h2hMatchCount,
  } = features;

  const homeAvgGoals = (avgGoalsScoredHome || 1.4) + (avgGoalsConcededHome || 1.1);
  const awayAvgGoals = (avgGoalsScoredAway || 1.1) + (avgGoalsConcededAway || 1.4);
  const avgGoalsCombined = Number(((homeAvgGoals + awayAvgGoals) / 2).toFixed(2));

  // Initialize scores for candidates based on world football base probabilities
  let scoreOver15 = 72;  // Base ~76% probability
  let scoreOver25 = 54;  // Base ~52% probability
  let scoreUnder25 = 48; // Base ~48% probability
  let scoreUnder35 = 70; // Base ~76% probability
  let scoreOver35 = 28;  // Base ~28% probability

  const reasonsOver15 = [];
  const reasonsOver25 = [];
  const reasonsUnder25 = [];
  const reasonsUnder35 = [];
  const reasonsOver35 = [];

  // 1. Evaluate Over 1.5
  if (h2hMatchCount > 0) {
    scoreOver15 += (over15RateH2H - 0.7) * 25;
    if (over15RateH2H > 0.75) {
      reasonsOver15.push(`${Math.round(over15RateH2H * 100)}% of recent H2H matches produced over 1.5 goals`);
    }
  }
  if (over15Rate > 0) {
    scoreOver15 += (over15Rate - 0.7) * 20;
  }
  scoreOver15 += (avgGoalsCombined - 2.2) * 12;
  if (avgGoalsCombined >= 2.4) {
    reasonsOver15.push(`High combined scoring average of ${avgGoalsCombined} goals per match`);
  }

  // 2. Evaluate Over 2.5
  if (h2hMatchCount > 0) {
    scoreOver25 += (over25RateH2H - 0.5) * 30;
    if (over25RateH2H > 0.6) {
      reasonsOver25.push(`${Math.round(over25RateH2H * 100)}% of recent H2H matches finished with over 2.5 goals`);
    }
    if (avgGoalsH2H > 2.7) {
      reasonsOver25.push(`H2H matches average ${avgGoalsH2H} goals per match`);
    }
  }
  if (over25Rate > 0) {
    scoreOver25 += (over25Rate - 0.5) * 25;
  }
  scoreOver25 += (avgGoalsCombined - 2.5) * 16;
  if (over25ImpliedProb) {
    scoreOver25 = (scoreOver25 * 0.45) + (over25ImpliedProb * 55);
    reasonsOver25.push(`Bookmaker odds favor Over 2.5 with a ${Math.round(over25ImpliedProb * 100)}% implied probability`);
  }

  const hasHighScoringH2H = h2hMatchCount > 0 && over25RateH2H >= 0.65;
  if (avgGoalsCombined >= 2.8 || hasHighScoringH2H || over25Rate >= 0.65) {
    scoreOver25 += 10;
  }

  // 3. Evaluate Under 2.5
  if (h2hMatchCount > 0) {
    scoreUnder25 += (0.5 - over25RateH2H) * 30;
    if (over25RateH2H < 0.4) {
      reasonsUnder25.push(`Low-scoring H2H history, with under 2.5 goals in ${Math.round((1 - over25RateH2H) * 100)}% of matches`);
    }
  }
  if (under25Rate > 0) {
    scoreUnder25 += (under25Rate - 0.5) * 25;
  }
  scoreUnder25 += (2.4 - avgGoalsCombined) * 18;
  if (avgGoalsCombined < 2.2) {
    reasonsUnder25.push(`Low combined goal average of ${avgGoalsCombined} goals per match`);
  }
  if (under25ImpliedProb) {
    scoreUnder25 = (scoreUnder25 * 0.45) + (under25ImpliedProb * 55);
    reasonsUnder25.push(`Bookmaker odds reflect a ${Math.round(under25ImpliedProb * 100)}% probability for Under 2.5 goals`);
  }

  // 4. Evaluate Under 3.5 (High safety margin line)
  if (h2hMatchCount > 0) {
    scoreUnder35 += (0.6 - (over25RateH2H * 0.7)) * 20;
  }
  scoreUnder35 += (2.8 - avgGoalsCombined) * 14;
  if (avgGoalsCombined <= 2.8) {
    reasonsUnder35.push(`Structured defensive setups keep total scoring below 3 goals per match`);
  }
  if (avgGoalsCombined > 3.4) {
    scoreUnder35 -= 25;
  }

  // 5. Evaluate Over 3.5
  scoreOver35 += (avgGoalsCombined - 3.2) * 18;
  if (avgGoalsCombined > 3.4) {
    reasonsOver35.push(`Extreme offensive profiles with combined goals average of ${avgGoalsCombined}`);
  }

  // Balance Over 1.5 vs Over 2.5 in very high-scoring matches
  if (avgGoalsCombined >= 2.9) {
    scoreOver15 = Math.min(80, scoreOver15);
  }

  // Cap scores between 10 and 95
  scoreOver15 = Math.max(10, Math.min(95, Math.round(scoreOver15)));
  scoreOver25 = Math.max(10, Math.min(95, Math.round(scoreOver25)));
  scoreUnder25 = Math.max(10, Math.min(95, Math.round(scoreUnder25)));
  scoreUnder35 = Math.max(10, Math.min(95, Math.round(scoreUnder35)));
  scoreOver35 = Math.max(10, Math.min(95, Math.round(scoreOver35)));

  // Select candidate with the best balance of probability and conviction
  const candidates = [
    { selection: 'Over 1.5', score: scoreOver15, reasons: reasonsOver15 },
    { selection: 'Over 2.5', score: scoreOver25, reasons: reasonsOver25 },
    { selection: 'Under 2.5', score: scoreUnder25, reasons: reasonsUnder25 },
    { selection: 'Under 3.5', score: scoreUnder35, reasons: reasonsUnder35 },
    { selection: 'Over 3.5', score: scoreOver35, reasons: reasonsOver35 },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner.reasons.length === 0) {
    winner.reasons.push(`Supported by recent scoring averages, league trends, and team form.`);
  }

  return {
    market: 'Over/Under',
    selection: winner.selection,
    rawScore: winner.score,
    confidence: Number((winner.score / 100).toFixed(2)),
    reasons: winner.reasons.slice(0, 3),
  };
}
