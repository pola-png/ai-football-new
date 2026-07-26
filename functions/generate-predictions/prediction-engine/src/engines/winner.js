/**
 * Winner Market Engine.
 * Predicts: Home Win, Away Win, Draw
 * @param {object} features - Combined extracted features
 * @returns {object} Market prediction output
 */
export function predictWinner(features) {
  const {
    homeFormScore,
    awayFormScore,
    homeStrength,
    awayStrength,
    strengthDifference,
    strengthRatio,
    homeRank,
    awayRank,
    rankDifference,
    homeImpliedProb,
    awayImpliedProb,
    drawImpliedProb,
    homeWinRateH2H,
    awayWinRateH2H,
    drawRateH2H,
  } = features;

  // Initialize raw scores
  let homeScore = 35; // base percentage
  let awayScore = 28;
  let drawScore = 25;

  const reasonsHome = [];
  const reasonsAway = [];
  const reasonsDraw = [];

  // 1. Incorporate Elo strength
  homeScore += strengthRatio * 30;
  awayScore += (1 - strengthRatio) * 30;
  if (Math.abs(strengthDifference) < 50) {
    drawScore += 15;
    reasonsDraw.push(`Close Elo rating difference of ${Math.abs(strengthDifference)} points`);
  } else if (strengthDifference > 100) {
    homeScore += 10;
    reasonsHome.push(`Home team has significant Elo strength advantage (+${strengthDifference})`);
  } else if (strengthDifference < -100) {
    awayScore += 10;
    reasonsAway.push(`Away team has significant Elo strength advantage (+${Math.abs(strengthDifference)})`);
  }

  // 2. Incorporate Standings rank
  if (homeRank !== null && awayRank !== null) {
    if (rankDifference < 0) {
      // Home higher ranked
      const bonus = Math.min(15, Math.abs(rankDifference) * 1.5);
      homeScore += bonus;
      reasonsHome.push(`Home team is ranked higher by ${Math.abs(rankDifference)} places`);
    } else if (rankDifference > 0) {
      // Away higher ranked
      const bonus = Math.min(15, rankDifference * 1.5);
      awayScore += bonus;
      reasonsAway.push(`Away team is ranked higher by ${rankDifference} places`);
    }
  }

  // 3. Incorporate Form
  const formDiff = homeFormScore - awayFormScore;
  homeScore += formDiff * 0.15;
  awayScore -= formDiff * 0.15;
  if (homeFormScore > 65) {
    homeScore += 5;
    reasonsHome.push(`Home team is in strong recent form (form score ${homeFormScore}%)`);
  }
  if (awayFormScore > 65) {
    awayScore += 5;
    reasonsAway.push(`Away team is in strong recent form (form score ${awayFormScore}%)`);
  }
  if (Math.abs(formDiff) < 10) {
    drawScore += 5;
  }

  // 4. Incorporate H2H Win Rates
  if (homeWinRateH2H > 0.4) {
    homeScore += homeWinRateH2H * 15;
    reasonsHome.push(`Home team won ${Math.round(homeWinRateH2H * 100)}% of historical H2H matches`);
  }
  if (awayWinRateH2H > 0.4) {
    awayScore += awayWinRateH2H * 15;
    reasonsAway.push(`Away team won ${Math.round(awayWinRateH2H * 100)}% of historical H2H matches`);
  }
  if (drawRateH2H > 0.3) {
    drawScore += drawRateH2H * 15;
    reasonsDraw.push(`High H2H draw rate of ${Math.round(drawRateH2H * 100)}%`);
  }

  // 5. Incorporate Bookmaker Implied Probabilities
  if (homeImpliedProb) {
    homeScore = (homeScore * 0.5) + (homeImpliedProb * 50);
    reasonsHome.push(`Bookmaker implied probability of home win is ${Math.round(homeImpliedProb * 100)}%`);
  }
  if (awayImpliedProb) {
    awayScore = (awayScore * 0.5) + (awayImpliedProb * 50);
    reasonsAway.push(`Bookmaker implied probability of away win is ${Math.round(awayImpliedProb * 100)}%`);
  }
  if (drawImpliedProb) {
    drawScore = (drawScore * 0.5) + (drawImpliedProb * 50);
    reasonsDraw.push(`Bookmaker implied probability of draw is ${Math.round(drawImpliedProb * 100)}%`);
  }

  // Final scoring selection
  let bestSelection = 'Home Win';
  let bestScore = homeScore;
  let bestReasons = reasonsHome;

  if (awayScore > bestScore) {
    bestSelection = 'Away Win';
    bestScore = awayScore;
    bestReasons = reasonsAway;
  }
  if (drawScore > bestScore) {
    bestSelection = 'Draw';
    bestScore = drawScore;
    bestReasons = reasonsDraw;
  }

  // Cap score between 0 and 100
  bestScore = Math.max(0, Math.min(100, Math.round(bestScore)));
  
  // Ensure we have at least one general fallback reason if list is empty
  if (bestReasons.length === 0) {
    bestReasons.push(`Supported by recent head-to-head records and strength parameters.`);
  }

  return {
    market: 'Winner',
    selection: bestSelection,
    rawScore: bestScore,
    confidence: Number((bestScore / 100).toFixed(2)),
    reasons: bestReasons.slice(0, 3), // limit to top 3 reasons
  };
}
