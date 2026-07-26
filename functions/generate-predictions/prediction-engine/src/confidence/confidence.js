/**
 * Calculates a refined confidence value for a market prediction.
 * @param {object} prediction - The raw prediction object from a market engine
 * @param {object} features - Combined extracted features
 * @returns {number} Refined confidence value between 0.0 and 1.0
 */
export function calculateConfidence(prediction, features) {
  const {
    hasStandings,
    hasOdds,
    h2hMatchCount,
    homeFormScore,
    awayFormScore,
    homeImpliedProb,
    awayImpliedProb,
    drawImpliedProb,
    bttsYesImpliedProb,
    bttsNoImpliedProb,
    over25ImpliedProb,
    under25ImpliedProb,
  } = features;

  // Factor 1: Data Completeness (0.0 to 1.0)
  let dataCompleteness = 1.0;
  if (!hasStandings) dataCompleteness -= 0.15;
  if (!hasOdds) dataCompleteness -= 0.15;
  if (h2hMatchCount === 0) dataCompleteness -= 0.20;
  else if (h2hMatchCount < 3) dataCompleteness -= 0.10;
  dataCompleteness = Math.max(0.4, dataCompleteness);

  // Factor 2: H2H Volume (0.0 to 1.0)
  const h2hVolume = Math.min(1.0, h2hMatchCount / 5);

  // Factor 3: Bookmaker Agreement (0.0 to 1.0)
  let bookmakerAgreement = 0.75; // neutral fallback
  if (hasOdds) {
    const market = prediction.market;
    const selection = prediction.selection;

    if (market === 'Winner') {
      if (selection === 'Home Win' && homeImpliedProb) {
        bookmakerAgreement = homeImpliedProb > 0.50 ? 1.0 : (homeImpliedProb > 0.35 ? 0.8 : 0.5);
      } else if (selection === 'Away Win' && awayImpliedProb) {
        bookmakerAgreement = awayImpliedProb > 0.50 ? 1.0 : (awayImpliedProb > 0.35 ? 0.8 : 0.5);
      } else if (selection === 'Draw' && drawImpliedProb) {
        bookmakerAgreement = drawImpliedProb > 0.30 ? 1.0 : (drawImpliedProb > 0.20 ? 0.8 : 0.5);
      }
    } else if (market === 'BTTS') {
      if (selection === 'Yes' && bttsYesImpliedProb) {
        bookmakerAgreement = bttsYesImpliedProb > 0.50 ? 1.0 : (bttsYesImpliedProb > 0.40 ? 0.8 : 0.5);
      } else if (selection === 'No' && bttsNoImpliedProb) {
        bookmakerAgreement = bttsNoImpliedProb > 0.50 ? 1.0 : (bttsNoImpliedProb > 0.40 ? 0.8 : 0.5);
      }
    } else if (market === 'Over/Under') {
      if (selection === 'Over 2.5' && over25ImpliedProb) {
        bookmakerAgreement = over25ImpliedProb > 0.50 ? 1.0 : (over25ImpliedProb > 0.40 ? 0.8 : 0.5);
      } else if (selection === 'Under 2.5' && under25ImpliedProb) {
        bookmakerAgreement = under25ImpliedProb > 0.50 ? 1.0 : (under25ImpliedProb > 0.40 ? 0.8 : 0.5);
      } else if (selection === 'Over 1.5') {
        // Over 1.5 implies generally high goal probability
        const p25 = over25ImpliedProb || 0.5;
        bookmakerAgreement = p25 > 0.40 ? 1.0 : 0.7;
      }
    }
  }

  // Factor 4: Team Consistency / Form Quality (0.0 to 1.0)
  // Higher discrepancy or higher extremity in form allows more confident modeling
  const formExtremity = (Math.abs(homeFormScore - 50) + Math.abs(awayFormScore - 50)) / 100;
  const consistency = Math.min(1.0, 0.7 + formExtremity * 0.3);

  // Factor 5: Engine Raw Score (0.0 to 1.0)
  const engineRawScore = prediction.rawScore / 100;

  // Average the factors
  const weights = {
    dataCompleteness: 0.15,
    h2hVolume: 0.15,
    bookmakerAgreement: 0.25,
    consistency: 0.15,
    engineRawScore: 0.30,
  };

  const weightedSum =
    (dataCompleteness * weights.dataCompleteness) +
    (h2hVolume * weights.h2hVolume) +
    (bookmakerAgreement * weights.bookmakerAgreement) +
    (consistency * weights.consistency) +
    (engineRawScore * weights.engineRawScore);

  return Number(weightedSum.toFixed(2));
}
