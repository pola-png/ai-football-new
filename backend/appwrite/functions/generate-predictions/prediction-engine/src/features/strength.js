/**
 * Calculates Elo-style team strength ratings.
 * @param {Array} h2hRows - List of historical H2H matches
 * @param {object} standingsFeatures - Extracted standings features
 * @param {string} homeTeamApiId - Home team API ID
 * @param {string} awayTeamApiId - Away team API ID
 * @returns {object} Strength features containing ratings and difference metrics
 */
export function calculateStrengthFeatures(h2hRows = [], standingsFeatures = {}, homeTeamApiId = '', awayTeamApiId = '') {
  let homeStrength = 1500;
  let awayStrength = 1500;

  // 1. Adjust baseline based on standings if available
  if (standingsFeatures && standingsFeatures.hasStandings) {
    // A point difference of 10 points could adjust strength by 50 Elo points
    homeStrength += standingsFeatures.homePoints * 4;
    awayStrength += standingsFeatures.awayPoints * 4;

    // Adjust for rank (higher rank, better Elo)
    // Assuming a standard league of 20 teams, difference in rank adjusts up to 100 Elo points
    homeStrength += (20 - standingsFeatures.homeRank) * 5;
    awayStrength += (20 - standingsFeatures.awayRank) * 5;
  }

  // 2. Chronologically update Elo ratings using H2H history
  const validH2H = [...h2hRows]
    .filter(row => row.home_score !== null && row.away_score !== null)
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at)); // oldest to newest

  const K_FACTOR = 32;

  for (const row of validH2H) {
    const hs = Number(row.home_score);
    const as = Number(row.away_score);
    const isHomeTeamActualHome = String(row.home_team_api_id) === String(homeTeamApiId);

    // Calculate expected scores
    const ratingDiff = awayStrength - homeStrength;
    const expectedHome = 1 / (1 + Math.pow(10, ratingDiff / 400));
    const expectedAway = 1 - expectedHome;

    // Determine actual score from home team perspective
    let actualHome = 0.5; // draw
    if (row.winner) {
      const isWinnerHome = String(row.winner) === 'home' || String(row.winner) === String(row.home_team_api_id);
      const isWinnerAway = String(row.winner) === 'away' || String(row.winner) === String(row.away_team_api_id);
      if (isWinnerHome) {
        actualHome = isHomeTeamActualHome ? 1.0 : 0.0;
      } else if (isWinnerAway) {
        actualHome = isHomeTeamActualHome ? 0.0 : 1.0;
      }
    } else {
      if (hs > as) {
        actualHome = isHomeTeamActualHome ? 1.0 : 0.0;
      } else if (as > hs) {
        actualHome = isHomeTeamActualHome ? 0.0 : 1.0;
      }
    }

    const actualAway = 1.0 - actualHome;

    // Update strengths
    homeStrength += K_FACTOR * (actualHome - expectedHome);
    awayStrength += K_FACTOR * (actualAway - expectedAway);
  }

  // Round ratings
  homeStrength = Math.round(homeStrength);
  awayStrength = Math.round(awayStrength);

  const strengthDifference = homeStrength - awayStrength;
  const strengthRatio = Number((homeStrength / (homeStrength + awayStrength)).toFixed(4));

  return {
    homeStrength,
    awayStrength,
    strengthDifference,
    strengthRatio,
  };
}
