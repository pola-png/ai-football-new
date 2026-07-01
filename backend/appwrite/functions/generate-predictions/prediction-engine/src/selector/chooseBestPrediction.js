/**
 * Selects the best prediction from the weighted candidates.
 * Sorts all markets by weightedScore descending and returns the highest.
 * @param {Array} weightedPredictions - Candidate predictions with weightedScore
 * @param {object} features - Extracted features for support references
 * @returns {object} The chosen best prediction object
 */
export function chooseBestPrediction(weightedPredictions = [], features = {}) {
  if (weightedPredictions.length === 0) {
    throw new Error('No candidate predictions provided to select from.');
  }

  // Sort candidates by weightedScore descending
  const sorted = [...weightedPredictions].sort((a, b) => b.weightedScore - a.weightedScore);
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
