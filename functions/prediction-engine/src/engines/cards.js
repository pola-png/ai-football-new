/**
 * Cards Market Engine (Optional/Specialized).
 * Predicts: Over 3.5, Under 4.5
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictCards(features) {
  const { avgCards } = features;

  const reasons = [];
  let selection = 'Over 3.5';
  let score = 55;

  if (avgCards > 4.2) {
    selection = 'Over 3.5';
    score += (avgCards - 3.5) * 12;
    reasons.push(`Highly combative matchup expected; teams average a combined ${avgCards.toFixed(1)} cards/match`);
  } else {
    selection = 'Under 4.5';
    score += (4.5 - avgCards) * 12;
    reasons.push(`Disciplined play-styles; matches average a low ${avgCards.toFixed(1)} cards per match`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    market: 'Cards',
    selection,
    rawScore: score,
    confidence: Number((score / 100).toFixed(2)),
    reasons: reasons.slice(0, 3),
  };
}
