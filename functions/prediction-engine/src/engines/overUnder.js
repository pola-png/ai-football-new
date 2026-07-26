/**
 * Over/Under Goals Market Engine.
 * Predicts: Over 1.5, Over 2.5, Under 2.5, Over 3.5
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
  } = features;

  const homeAvgGoals = avgGoalsScoredHome + avgGoalsConcededHome;
  const awayAvgGoals = avgGoalsScoredAway + avgGoalsConcededAway;
  const avgGoalsCombined = Number(((homeAvgGoals + awayAvgGoals) / 2).toFixed(2));

  // Initialize scores for candidates
  let scoreOver15 = 55; // base
  let scoreOver25 = 45;
  let scoreUnder25 = 45;
  let scoreOver35 = 25;

  const reasonsOver15 = [];
  const reasonsOver25 = [];
  const reasonsUnder25 = [];
  const reasonsOver35 = [];

  // 1. Evaluate Over 1.5
  scoreOver15 += (over15RateH2H - 0.7) * 30;
  scoreOver15 += (over15Rate - 0.7) * 20;
  scoreOver15 += (avgGoalsCombined - 2.0) * 10;
  if (over15RateH2H > 0.75) {
    reasonsOver15.push(`${Math.round(over15RateH2H * 100)}% of recent H2H matches produced over 1.5 goals`);
  }
  if (avgGoalsCombined > 2.6) {
    reasonsOver15.push(`High combined goal average of ${avgGoalsCombined} goals per match`);
  }

  // 2. Evaluate Over 2.5
  scoreOver25 += (over25RateH2H - 0.5) * 30;
  scoreOver25 += (over25Rate - 0.5) * 20;
  scoreOver25 += (avgGoalsCombined - 2.5) * 15;
  if (over25RateH2H > 0.6) {
    reasonsOver25.push(`${Math.round(over25RateH2H * 100)}% of recent H2H matches finished with over 2.5 goals`);
  }
  if (avgGoalsH2H > 2.7) {
    reasonsOver25.push(`H2H matches average ${avgGoalsH2H} goals per match`);
  }
  if (over25ImpliedProb) {
    scoreOver25 = (scoreOver25 * 0.4) + (over25ImpliedProb * 60);
    reasonsOver25.push(`Bookmaker odds favor Over 2.5 with a ${Math.round(over25ImpliedProb * 100)}% implied probability`);
  }

  // Boost Over 2.5 if teams have a high-scoring profile
  if (avgGoalsCombined >= 2.7 || over25RateH2H >= 0.65 || over25Rate >= 0.65) {
    scoreOver25 += 12;
  }

  // 3. Evaluate Under 2.5
  scoreUnder25 += (0.5 - over25RateH2H) * 30;
  scoreUnder25 += (under25Rate - 0.5) * 20;
  scoreUnder25 += (2.5 - avgGoalsCombined) * 15;
  if (over25RateH2H < 0.4 && over25RateH2H > 0) {
    reasonsUnder25.push(`Low-scoring H2H history, with under 2.5 goals in ${Math.round((1 - over25RateH2H) * 100)}% of matches`);
  }
  if (avgGoalsCombined < 2.2) {
    reasonsUnder25.push(`Low combined goal average of ${avgGoalsCombined} goals per match`);
  }
  if (under25ImpliedProb) {
    scoreUnder25 = (scoreUnder25 * 0.4) + (under25ImpliedProb * 60);
    reasonsUnder25.push(`Bookmaker odds reflect a ${Math.round(under25ImpliedProb * 100)}% probability for Under 2.5 goals`);
  }

  // 4. Evaluate Over 3.5
  scoreOver35 += (avgGoalsCombined - 3.2) * 15;
  if (avgGoalsCombined > 3.4) {
    reasonsOver35.push(`Extreme offensive profiles with combined goals average of ${avgGoalsCombined}`);
  }

  // Cap Over 1.5 if it is a high-scoring matchup to favor Over 2.5
  if (avgGoalsCombined >= 2.7) {
    scoreOver15 = Math.min(70, scoreOver15);
  }

  // Cap scores
  scoreOver15 = Math.max(0, Math.min(100, Math.round(scoreOver15)));
  scoreOver25 = Math.max(0, Math.min(100, Math.round(scoreOver25)));
  scoreUnder25 = Math.max(0, Math.min(100, Math.round(scoreUnder25)));
  scoreOver35 = Math.max(0, Math.min(100, Math.round(scoreOver35)));

  // Select the highest score
  const candidates = [
    { selection: 'Over 1.5', score: scoreOver15, reasons: reasonsOver15 },
    { selection: 'Over 2.5', score: scoreOver25, reasons: reasonsOver25 },
    { selection: 'Under 2.5', score: scoreUnder25, reasons: reasonsUnder25 },
    { selection: 'Over 3.5', score: scoreOver35, reasons: reasonsOver35 },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner.reasons.length === 0) {
    winner.reasons.push(`Supported by recent scoring averages and team form.`);
  }

  return {
    market: 'Over/Under',
    selection: winner.selection,
    rawScore: winner.score,
    confidence: Number((winner.score / 100).toFixed(2)),
    reasons: winner.reasons.slice(0, 3),
  };
}
