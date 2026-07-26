/**
 * Extracts features from betting odds, calculating implied probabilities.
 * @param {Array} oddsRows - List of odds rows from Appwrite
 * @returns {object} Extracted odds features
 */
export function extractOddsFeatures(oddsRows = []) {
  const features = {
    homeImpliedProb: null,
    awayImpliedProb: null,
    drawImpliedProb: null,
    over25ImpliedProb: null,
    under25ImpliedProb: null,
    bttsYesImpliedProb: null,
    bttsNoImpliedProb: null,
    hasOdds: false,
    rawOdds: {}, // raw odd values for reason builder or debugging
  };

  if (!oddsRows || oddsRows.length === 0) {
    return features;
  }

  // Helper to parse float safely
  const parseOdd = (val) => {
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : null;
  };

  // Helper to convert odd to implied probability
  const getProb = (odd) => {
    const parsed = parseOdd(odd);
    return parsed ? Number((1 / parsed).toFixed(4)) : null;
  };

  for (const row of oddsRows) {
    const market = String(row.market_name || '').trim().toLowerCase();
    const selection = String(row.selection_name || '').trim().toLowerCase();
    const value = parseOdd(row.odd_value);

    if (!value) continue;
    features.hasOdds = true;

    // 1. Match Winner (1X2)
    if (market.includes('winner') || market.includes('1x2') || market.includes('match odds') || market.includes('match winner')) {
      if (selection === 'home' || selection === '1' || selection.includes('home')) {
        features.homeImpliedProb = getProb(value);
        features.rawOdds.home = value;
      } else if (selection === 'away' || selection === '2' || selection.includes('away')) {
        features.awayImpliedProb = getProb(value);
        features.rawOdds.away = value;
      } else if (selection === 'draw' || selection === 'x' || selection.includes('draw')) {
        features.drawImpliedProb = getProb(value);
        features.rawOdds.draw = value;
      }
    }

    // 2. Both Teams To Score (BTTS)
    if (market.includes('both teams to score') || market.includes('btts') || market.includes('both teams score')) {
      if (selection === 'yes') {
        features.bttsYesImpliedProb = getProb(value);
        features.rawOdds.bttsYes = value;
      } else if (selection === 'no') {
        features.bttsNoImpliedProb = getProb(value);
        features.rawOdds.bttsNo = value;
      }
    }

    // 3. Goals Over/Under (focus on 2.5 line)
    if (market.includes('over/under') || market.includes('goals over/under') || market.includes('total goals')) {
      const line = String(row.line_value || '').trim();
      const is25 = line === '2.5' || selection.includes('2.5');
      
      if (is25) {
        if (selection.includes('over')) {
          features.over25ImpliedProb = getProb(value);
          features.rawOdds.over25 = value;
        } else if (selection.includes('under')) {
          features.under25ImpliedProb = getProb(value);
          features.rawOdds.under25 = value;
        }
      }
    }
  }

  // Calculate bookmaker margin adjustments if all 3 1X2 outcomes exist
  if (features.homeImpliedProb && features.awayImpliedProb && features.drawImpliedProb) {
    const sum = features.homeImpliedProb + features.awayImpliedProb + features.drawImpliedProb;
    // Normalize to sum to 1.0 (remove overround margin)
    features.homeImpliedProb = Number((features.homeImpliedProb / sum).toFixed(4));
    features.awayImpliedProb = Number((features.awayImpliedProb / sum).toFixed(4));
    features.drawImpliedProb = Number((features.drawImpliedProb / sum).toFixed(4));
  }

  // Normalize Over/Under if both exist
  if (features.over25ImpliedProb && features.under25ImpliedProb) {
    const sum = features.over25ImpliedProb + features.under25ImpliedProb;
    features.over25ImpliedProb = Number((features.over25ImpliedProb / sum).toFixed(4));
    features.under25ImpliedProb = Number((features.under25ImpliedProb / sum).toFixed(4));
  }

  // Normalize BTTS if both exist
  if (features.bttsYesImpliedProb && features.bttsNoImpliedProb) {
    const sum = features.bttsYesImpliedProb + features.bttsNoImpliedProb;
    features.bttsYesImpliedProb = Number((features.bttsYesImpliedProb / sum).toFixed(4));
    features.bttsNoImpliedProb = Number((features.bttsNoImpliedProb / sum).toFixed(4));
  }

  return features;
}
