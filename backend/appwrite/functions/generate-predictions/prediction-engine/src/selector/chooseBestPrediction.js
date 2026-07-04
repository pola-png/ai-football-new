/**
 * Selects the best prediction from the weighted candidates.
 * Sorts all markets by weightedScore descending and returns the highest.
 * @param {Array} weightedPredictions - Candidate predictions with weightedScore
 * @param {object} features - Extracted features for support references
 * @returns {object} The chosen best prediction object
 */
const MARKET_VALUE_MULTIPLIERS = {
  'Winner': 1.20,
  'BTTS': 1.10,
  'Over/Under': 1.15,
  'Draw': 1.00,
  'Double Chance': 0.80,
  'Corners': 1.00,
  'Cards': 1.00,
};

export function chooseBestPrediction(weightedPredictions = [], features = {}) {
  if (weightedPredictions.length === 0) {
    throw new Error('No candidate predictions provided to select from.');
  }

  // Calculate final selection score by applying the value multipliers
  const evaluated = weightedPredictions.map(pred => {
    const multiplier = MARKET_VALUE_MULTIPLIERS[pred.market] ?? 1.0;
    const selectionScore = Number((pred.weightedScore * multiplier).toFixed(2));
    return {
      ...pred,
      selectionScore,
    };
  });

  // Filter out restricted Over/Under lines if they do not meet the 98% confidence requirement
  const filtered = evaluated.filter(pred => {
    const isRestricted =
      pred.market === 'Over/Under' &&
      (pred.selection === 'Under 2.5' || pred.selection === 'Under 3.5' || pred.selection === 'Over 3.5');

    if (isRestricted && pred.confidence < 0.98) {
      return false;
    }
    return true;
  });

  // Sort candidates by selectionScore descending
  const sorted = (filtered.length > 0 ? filtered : evaluated).sort((a, b) => b.selectionScore - a.selectionScore);
  const best = sorted[0];

  return {
    market: best.market,
    selection: best.selection,
    confidence: best.confidence,
    weightedScore: best.weightedScore,
    rawScore: best.rawScore,
    reasons: best.reasons || [],
    supportingStatistics: {
      homeFormScore: features.homeFormScore,
      awayFormScore: features.awayFormScore,
      homeStrength: features.homeStrength,
      awayStrength: features.awayStrength,
      h2hMatchCount: features.h2hMatchCount,
      over25Rate: features.over25Rate,
      bttsRate: features.bttsRate,
      avgGoalsScoredHome: features.avgGoalsScoredHome,
      avgGoalsScoredAway: features.avgGoalsScoredAway,
    },
    allCandidates: sorted, // keeping candidates for debugging or secondary predictions
  };
}
