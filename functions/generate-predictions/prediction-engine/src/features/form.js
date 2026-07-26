/**
 * Extracts form features for both home and away teams.
 * Calculates form score out of 100 based on recent results (W=3, D=1, L=0).
 * @param {Array} h2hRows - Historical H2H matches between the teams
 * @param {object} [homeStats] - Team stats for home team
 * @param {object} [awayStats] - Team stats for away team
 * @param {string} homeTeamApiId - Home team API ID
 * @param {string} awayTeamApiId - Away team API ID
 * @returns {object} Extracted form features
 */
export function extractFormFeatures(h2hRows = [], homeStats = null, awayStats = null, homeTeamApiId = '', awayTeamApiId = '') {
  const features = {
    homeFormScore: 50, // default neutral form
    awayFormScore: 50,
    homeFormString: '',
    awayFormString: '',
  };

  // Helper to convert form string like "WDLWW" to 0-100 score
  const calculateFormScoreFromString = (formStr) => {
    if (!formStr || typeof formStr !== 'string') return 50;
    const cleanForm = formStr.trim().toUpperCase().slice(-5); // get last 5 matches
    if (cleanForm.length === 0) return 50;

    let points = 0;
    for (const char of cleanForm) {
      if (char === 'W') points += 3;
      else if (char === 'D') points += 1;
    }
    return Math.round((points / (cleanForm.length * 3)) * 100);
  };

  // 1. Try to load form from stats
  let homeFormFound = false;
  let awayFormFound = false;

  if (homeStats && typeof homeStats.form === 'string') {
    features.homeFormString = homeStats.form.trim();
    features.homeFormScore = calculateFormScoreFromString(features.homeFormString);
    homeFormFound = true;
  }
  if (awayStats && typeof awayStats.form === 'string') {
    features.awayFormString = awayStats.form.trim();
    features.awayFormScore = calculateFormScoreFromString(features.awayFormString);
    awayFormFound = true;
  }

  // 2. Fallback to using H2H rows to determine relative form if general form is missing
  if (!homeFormFound || !awayFormFound) {
    const validH2H = [...h2hRows]
      .filter(row => row.home_score !== null && row.away_score !== null)
      .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at)); // chronological

    if (validH2H.length > 0) {
      const homeResults = [];
      const awayResults = [];

      for (const row of validH2H) {
        const isHomeTeamActualHome = String(row.home_team_api_id) === String(homeTeamApiId);
        
        // Find who won from current team perspective
        let outcome = 'D';
        if (row.winner) {
          const isWinnerHome = String(row.winner) === 'home' || String(row.winner) === String(row.home_team_api_id);
          const isWinnerAway = String(row.winner) === 'away' || String(row.winner) === String(row.away_team_api_id);
          
          if (isWinnerHome) {
            outcome = isHomeTeamActualHome ? 'W' : 'L';
          } else if (isWinnerAway) {
            outcome = isHomeTeamActualHome ? 'L' : 'W';
          }
        } else {
          // Compare scores
          const hs = Number(row.home_score);
          const as = Number(row.away_score);
          if (hs > as) {
            outcome = isHomeTeamActualHome ? 'W' : 'L';
          } else if (as > hs) {
            outcome = isHomeTeamActualHome ? 'L' : 'W';
          }
        }

        homeResults.push(outcome);
        // Away team outcome is opposite of home team
        awayResults.push(outcome === 'W' ? 'L' : (outcome === 'L' ? 'W' : 'D'));
      }

      if (!homeFormFound) {
        features.homeFormString = homeResults.slice(-5).join('');
        features.homeFormScore = calculateFormScoreFromString(features.homeFormString);
      }
      if (!awayFormFound) {
        features.awayFormString = awayResults.slice(-5).join('');
        features.awayFormScore = calculateFormScoreFromString(features.awayFormString);
      }
    }
  }

  return features;
}
