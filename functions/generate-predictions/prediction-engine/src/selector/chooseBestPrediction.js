/**
 * Selects the best prediction from the weighted candidates.
 * Sorts all markets by weightedScore descending and returns the highest.
 * @param {Array} weightedPredictions - Candidate predictions with weightedScore
 * @param {object} features - Extracted features for support references
 * @returns {object} The chosen best prediction object
 */
const MARKET_VALUE_MULTIPLIERS = {
  'Over/Under': 1.15,
  'Winner': 1.12,
  'Double Chance': 1.10,
  'BTTS': 1.00,
  'Corners': 0.90,
  'Cards': 0.90,
  'Draw': 0.80,
};

export function chooseBestPrediction(weightedPredictions = [], features = {}) {
  if (weightedPredictions.length === 0) {
    throw new Error('No candidate predictions provided to select from.');
  }

  const h2hCount = features.h2hMatchCount ?? 0;

  // Calculate final selection score by applying the value multipliers and contextual intelligence
  const evaluated = weightedPredictions.map(pred => {
    let multiplier = MARKET_VALUE_MULTIPLIERS[pred.market] ?? 1.0;

    // Intelligent context adjustments:
    // When H2H history is missing, BTTS is less certain than Over/Under or Double Chance
    if (h2hCount === 0) {
      if (pred.market === 'BTTS') {
        multiplier *= 0.85; // dampen BTTS when no head-to-head records exist
      } else if (pred.market === 'Over/Under' && (pred.selection === 'Over 1.5' || pred.selection === 'Under 3.5')) {
        multiplier *= 1.08; // boost ultra-safe goal lines when H2H is missing
      } else if (pred.market === 'Double Chance') {
        multiplier *= 1.05; // boost double chance safety margin
      }
    }

    const selectionScore = Number((pred.weightedScore * multiplier).toFixed(2));
    return {
      ...pred,
      selectionScore,
    };
  });

  // Sort candidates by selectionScore descending (tie-break on confidence, then weightedScore)
  const sorted = [...evaluated].sort((a, b) => {
    if (b.selectionScore !== a.selectionScore) {
      return b.selectionScore - a.selectionScore;
    }
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.weightedScore - a.weightedScore;
  });
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
