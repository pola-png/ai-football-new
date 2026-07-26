/**
 * Formulates a coherent, analyst-style paragraph reasoning the prediction.
 * @param {object} chosen - Selected best prediction object from selector
 * @param {object} features - Combined extracted features
 * @param {object} fixture - Raw fixture document
 * @returns {string} A human-readable reasoning paragraph
 */
export function buildReason(chosen, features, fixture) {
  const { market, selection, reasons } = chosen;
  const homeTeam = fixture?.home_team_name || 'Home Team';
  const awayTeam = fixture?.away_team_name || 'Away Team';

  // Fallback if we cannot match the market type
  const baseReason = reasons.join(' ') || `This selection is supported by historical head-to-head statistics and Elo strength ratings.`;

  switch (market) {
    case 'Winner': {
      const eloAdv = features.strengthDifference > 0 
        ? `${homeTeam} holds an Elo rating advantage of ${features.strengthDifference} points` 
        : `${awayTeam} holds an Elo rating advantage of ${Math.abs(features.strengthDifference)} points`;
      
      const formComp = `Home form is rated at ${features.homeFormScore}% compared to Away form at ${features.awayFormScore}%`;
      const h2hStat = features.h2hMatchCount > 0 
        ? `with ${homeTeam} winning ${Math.round(features.homeWinRateH2H * 100)}% of their ${features.h2hMatchCount} historical encounters` 
        : 'with competitive head-to-head margins';

      return `${homeTeam} vs ${awayTeam} is a matchup where ${eloAdv}. ${formComp}, ${h2hStat}. Bookmaker pricing aligns with these metrics, making ${selection} the most high-probability option.`;
    }

    case 'BTTS': {
      if (selection === 'Yes') {
        const homeScoring = `${homeTeam} averages ${features.avgGoalsScoredHome.toFixed(1)} goals scored per match`;
        const awayScoring = `${awayTeam} averages ${features.avgGoalsScoredAway.toFixed(1)} goals scored per match`;
        const h2hGg = features.h2hMatchCount > 0 
          ? `, while ${Math.round(features.bttsRateH2H * 100)}% of recent meetings between these two sides saw both teams find the net` 
          : '';

        return `Both teams display highly productive offensive profiles. ${homeScoring} and ${awayScoring}${h2hGg}. Given defensive vulnerabilities on both sides, a clean sheet is unlikely, strongly favoring Both Teams to Score (Yes).`;
      } else {
        return `Defensive setups are expected to dominate this encounter. ${homeTeam} has failed to score in ${Math.round(features.failedToScoreRateHome * 100)}% of recent matches, while ${awayTeam} averages a low ${features.avgGoalsScoredAway.toFixed(1)} goals per match. This point towards a low-scoring game where at least one team fails to find the net.`;
      }
    }

    case 'Over/Under': {
      const combAvg = (features.avgGoalsScoredHome + features.avgGoalsConcededHome + features.avgGoalsScoredAway + features.avgGoalsConcededAway) / 2;
      
      if (selection.includes('Over')) {
        const h2hOver = features.h2hMatchCount > 0 
          ? `Recent head-to-head fixtures have been goal-heavy, with ${Math.round(features.over25RateH2H * 100)}% finishing over 2.5 goals.` 
          : '';
        return `An offensive game is anticipated, with both teams combining for an average of ${combAvg.toFixed(1)} goals per match in recent outings. ${h2hOver} The attacking momentum and bookmaker implied probabilities align to support the ${selection} goals line.`;
      } else {
        const h2hUnder = features.h2hMatchCount > 0 
          ? `, and ${Math.round((1 - features.over25RateH2H) * 100)}% of head-to-head meetings have stayed under the 2.5 goal threshold` 
          : '';
        return `A tight, tactical match is expected. Defensive structures are solid, keeping combined recent averages to ${combAvg.toFixed(1)} goals/match${h2hUnder}. Value lies in backing a low-scoring game under the specified goal line.`;
      }
    }

    case 'Double Chance': {
      const strengthText = features.strengthDifference > 0 
        ? `${homeTeam} has a distinct advantage playing at home, backed by an Elo rating of ${features.homeStrength}` 
        : `${awayTeam} shows strong resistance on the road, with an Elo rating of ${features.awayStrength}`;
      const formText = `Form scores stand at ${features.homeFormScore}% (Home) vs ${features.awayFormScore}% (Away)`;

      return `To mitigate risk, Double Chance (${selection}) is selected. ${strengthText}. ${formText}. This coverage offers high safety margins based on statistical parameters.`;
    }

    case 'Draw': {
      if (selection === 'Yes') {
        const ratingGap = Math.abs(features.strengthDifference);
        return `These teams are almost indistinguishable in quality, separated by just ${ratingGap} points in Elo rating. With similar form lines (${features.homeFormScore}% vs ${features.awayFormScore}%) and a high historical draw rate of ${Math.round(features.drawRateH2H * 100)}%, a shared-points outcome is highly probable.`;
      } else {
        const winnerFavour = features.strengthDifference > 0 ? homeTeam : awayTeam;
        return `A draw is unlikely in this fixture. ${winnerFavour} has a significant competitive advantage in form and strength difference. Historical matches have also been highly decisive, supporting Draw (No) or a direct win market.`;
      }
    }

    case 'Corners':
    case 'Cards': {
      const avg = market === 'Corners' ? features.avgCorners : features.avgCards;
      return `Detailed statistical tracking indicates a high correlation in this market. Teams average a combined ${avg.toFixed(1)} ${market.toLowerCase()} per match, making ${selection} the most mathematically backed selection.`;
    }

    default:
      return baseReason;
  }
}
