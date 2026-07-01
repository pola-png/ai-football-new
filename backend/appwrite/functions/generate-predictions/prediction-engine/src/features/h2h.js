/**
 * Extracts head-to-head (H2H) statistics.
 * @param {Array} h2hRows - List of historical H2H matches
 * @param {string} homeTeamApiId - Home team API ID
 * @param {string} awayTeamApiId - Away team API ID
 * @returns {object} Extracted H2H features
 */
export function extractH2HFeatures(h2hRows = [], homeTeamApiId = '', awayTeamApiId = '') {
  const features = {
    h2hMatchCount: 0,
    homeWinRateH2H: 0,
    awayWinRateH2H: 0,
    drawRateH2H: 0,
    avgGoalsH2H: 0,
    bttsRateH2H: 0,
    over15RateH2H: 0,
    over25RateH2H: 0,
    lastMeetingWinner: null,
  };

  const validH2H = h2hRows
    .filter(row => row.home_score !== null && row.away_score !== null)
    .sort((a, b) => new Date(b.kickoff_at) - new Date(a.kickoff_at)); // reverse-chronological (newest first)

  if (validH2H.length === 0) {
    return features;
  }

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let totalGoals = 0;
  let bttsCount = 0;
  let over15Count = 0;
  let over25Count = 0;

  for (let index = 0; index < validH2H.length; index++) {
    const row = validH2H[index];
    const hs = Number(row.home_score);
    const as = Number(row.away_score);
    const sum = hs + as;
    const isHomeTeamActualHome = String(row.home_team_api_id) === String(homeTeamApiId);

    // Track winner
    let matchWinner = 'draw';
    if (row.winner) {
      const isWinnerHome = String(row.winner) === 'home' || String(row.winner) === String(row.home_team_api_id);
      const isWinnerAway = String(row.winner) === 'away' || String(row.winner) === String(row.away_team_api_id);
      
      if (isWinnerHome) {
        matchWinner = isHomeTeamActualHome ? 'home' : 'away';
      } else if (isWinnerAway) {
        matchWinner = isHomeTeamActualHome ? 'away' : 'home';
      }
    } else {
      if (hs > as) {
        matchWinner = isHomeTeamActualHome ? 'home' : 'away';
      } else if (as > hs) {
        matchWinner = isHomeTeamActualHome ? 'away' : 'home';
      }
    }

    if (matchWinner === 'home') homeWins++;
    else if (matchWinner === 'away') awayWins++;
    else draws++;

    totalGoals += sum;
    if (hs > 0 && as > 0) bttsCount++;
    if (sum > 1.5) over15Count++;
    if (sum > 2.5) over25Count++;

    // Track last meeting winner
    if (index === 0) {
      features.lastMeetingWinner = matchWinner;
    }
  }

  const n = validH2H.length;
  features.h2hMatchCount = n;
  features.homeWinRateH2H = Number((homeWins / n).toFixed(2));
  features.awayWinRateH2H = Number((awayWins / n).toFixed(2));
  features.drawRateH2H = Number((draws / n).toFixed(2));
  features.avgGoalsH2H = Number((totalGoals / n).toFixed(2));
  features.bttsRateH2H = Number((bttsCount / n).toFixed(2));
  features.over15RateH2H = Number((over15Count / n).toFixed(2));
  features.over25RateH2H = Number((over25Count / n).toFixed(2));

  return features;
}
