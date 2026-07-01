/**
 * Default historical accuracies to use as baseline weights.
 * These reflect typical long-term prediction hit rates per market.
 */
export const DEFAULT_MARKET_ACCURACIES = {
  'Winner': 0.68,
  'BTTS': 0.78,
  'Over/Under': 0.71,
  'Draw': 0.65,
  'Double Chance': 0.83,
  'Corners': 0.72,
  'Cards': 0.70,
};

/**
 * Calculates weighted scores for a list of predictions based on historical accuracies.
 * Formula: weightedScore = rawScore * marketAccuracy
 * @param {Array} predictions - List of prediction objects from market engines
 * @param {object} [customAccuracies] - Custom historical accuracies loaded from DB
 * @returns {Array} List of predictions with weightedScore property added
 */
export function applyMarketWeights(predictions = [], customAccuracies = null) {
  const accuracies = {
    ...DEFAULT_MARKET_ACCURACIES,
    ...(customAccuracies || {}),
  };

  return predictions.map(pred => {
    // Normalise market key (e.g. 'Over/Under' -> 'Over/Under')
    const marketKey = pred.market;
    const accuracy = accuracies[marketKey] ?? 0.70; // fallback default accuracy

    const weightedScore = Number((pred.rawScore * accuracy).toFixed(2));

    return {
      ...pred,
      marketAccuracy: accuracy,
      weightedScore,
    };
  });
}
