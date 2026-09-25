/**
 * Extracts goal-related features from H2H history and team statistics.
 * @param {Array} h2hRows - List of historical H2H matches
 * @param {object} [homeStats] - Team stats for home team from Appwrite
 * @param {object} [awayStats] - Team stats for away team from Appwrite
 * @param {string} homeTeamApiId - Home team API ID
 * @param {string} awayTeamApiId - Away team API ID
 * @returns {object} Extracted goal features
 */
export function extractGoalsFeatures(h2hRows = [], homeStats = null, awayStats = null, homeTeamApiId = '', awayTeamApiId = '') {
  const features = {
    avgGoalsScoredHome: 0,
    avgGoalsScoredAway: 0,
    avgGoalsConcededHome: 0,
    avgGoalsConcededAway: 0,
    over15Rate: 0,
    over25Rate: 0,
    under25Rate: 0,
    bttsRate: 0,
    cleanSheetRateHome: 0,
    cleanSheetRateAway: 0,
    failedToScoreRateHome: 0,
    failedToScoreRateAway: 0,
    avgCorners: 0,
    avgCards: 0,
  };

  // 1. Process H2H rows for goals features (always available)
  const validH2H = h2hRows.filter(row => row.home_score !== null && row.away_score !== null);
  if (validH2H.length > 0) {
    let over15Count = 0;
    let over25Count = 0;
    let bttsCount = 0;
    let homeGoalsScored = 0;
    let awayGoalsScored = 0;
    let homeGoalsConceded = 0;
    let awayGoalsConceded = 0;
    let homeCleanSheets = 0;
    let awayCleanSheets = 0;
    let homeFailedToScore = 0;
    let awayFailedToScore = 0;

    for (const row of validH2H) {
      const homeScore = Number(row.home_score);
      const awayScore = Number(row.away_score);
      const totalGoals = homeScore + awayScore;

      // Determine which team in the H2H was the current home/away team
      const isHomeTeamActualHome = String(row.home_team_api_id) === String(homeTeamApiId);
      
      const homeTeamGoals = isHomeTeamActualHome ? homeScore : awayScore;
      const awayTeamGoals = isHomeTeamActualHome ? awayScore : homeScore;

      homeGoalsScored += homeTeamGoals;
      awayGoalsScored += awayTeamGoals;

      homeGoalsConceded += awayTeamGoals;
      awayGoalsConceded += homeTeamGoals;

      if (totalGoals > 1.5) over15Count++;
      if (totalGoals > 2.5) over25Count++;
      if (homeScore > 0 && awayScore > 0) bttsCount++;

      if (awayTeamGoals === 0) homeCleanSheets++;
      if (homeTeamGoals === 0) awayCleanSheets++;

      if (homeTeamGoals === 0) homeFailedToScore++;
      if (awayTeamGoals === 0) awayFailedToScore++;
    }

    const n = validH2H.length;
    features.avgGoalsScoredHome = Number((homeGoalsScored / n).toFixed(2));
    features.avgGoalsScoredAway = Number((awayGoalsScored / n).toFixed(2));
    features.avgGoalsConcededHome = Number((homeGoalsConceded / n).toFixed(2));
    features.avgGoalsConcededAway = Number((awayGoalsConceded / n).toFixed(2));
    features.over15Rate = Number((over15Count / n).toFixed(2));
    features.over25Rate = Number((over25Count / n).toFixed(2));
    features.under25Rate = Number((1 - features.over25Rate).toFixed(2));
    features.bttsRate = Number((bttsCount / n).toFixed(2));
    features.cleanSheetRateHome = Number((homeCleanSheets / n).toFixed(2));
    features.cleanSheetRateAway = Number((awayCleanSheets / n).toFixed(2));
    features.failedToScoreRateHome = Number((homeFailedToScore / n).toFixed(2));
    features.failedToScoreRateAway = Number((awayFailedToScore / n).toFixed(2));
  }

  // 2. Override/Supplement with teamStats if they exist (more comprehensive team performance)
  if (homeStats && homeStats.goals) {
    const homeGoalsScoredAvg = homeStats.goals.for?.average?.home || homeStats.goals.for?.average?.total;
    const homeGoalsConcededAvg = homeStats.goals.against?.average?.home || homeStats.goals.against?.average?.total;
    if (homeGoalsScoredAvg !== undefined) features.avgGoalsScoredHome = Number(homeGoalsScoredAvg);
    if (homeGoalsConcededAvg !== undefined) features.avgGoalsConcededHome = Number(homeGoalsConcededAvg);
    
    // Corners and cards from stats
    const homeCorners = homeStats.corners?.average || homeStats.corners?.total;
    if (homeCorners) features.avgCorners += Number(homeCorners) / 2;
    
    const homeCleanSheet = homeStats.clean_sheet?.total;
    const homeMatches = homeStats.fixtures?.played?.total;
    if (homeCleanSheet && homeMatches) {
      features.cleanSheetRateHome = Number((homeCleanSheet / homeMatches).toFixed(2));
    }
  }

  if (awayStats && awayStats.goals) {
    const awayGoalsScoredAvg = awayStats.goals.for?.average?.away || awayStats.goals.for?.average?.total;
    const awayGoalsConcededAvg = awayStats.goals.against?.average?.away || awayStats.goals.against?.average?.total;
    if (awayGoalsScoredAvg !== undefined) features.avgGoalsScoredAway = Number(awayGoalsScoredAvg);
    if (awayGoalsConcededAvg !== undefined) features.avgGoalsConcededAway = Number(awayGoalsConcededAvg);

    const awayCorners = awayStats.corners?.average || awayStats.corners?.total;
    if (awayCorners) features.avgCorners += Number(awayCorners) / 2;

    const awayCleanSheet = awayStats.clean_sheet?.total;
    const awayMatches = awayStats.fixtures?.played?.total;
    if (awayCleanSheet && awayMatches) {
      features.cleanSheetRateAway = Number((awayCleanSheet / awayMatches).toFixed(2));
    }
  }

  // Cards approximation if stats exist
  if (homeStats && homeStats.cards) {
    const yellow = Object.values(homeStats.cards.yellow || {}).reduce((acc, val) => acc + (val.total || 0), 0);
    const red = Object.values(homeStats.cards.red || {}).reduce((acc, val) => acc + (val.total || 0), 0);
    const matches = homeStats.fixtures?.played?.total || 1;
    features.avgCards += (yellow + red * 2) / matches / 2;
  }
  if (awayStats && awayStats.cards) {
    const yellow = Object.values(awayStats.cards.yellow || {}).reduce((acc, val) => acc + (val.total || 0), 0);
    const red = Object.values(awayStats.cards.red || {}).reduce((acc, val) => acc + (val.total || 0), 0);
    const matches = awayStats.fixtures?.played?.total || 1;
    features.avgCards += (yellow + red * 2) / matches / 2;
  }

  // Set default values for corners and cards if they are 0
  if (features.avgCorners === 0) features.avgCorners = 9.5; // football default
  if (features.avgCards === 0) features.avgCards = 4.2; // football default

  // 3. Estimate probability rates if H2H is missing
  if (validH2H.length === 0) {
    if (homeStats || awayStats) {
      const homeScored = features.avgGoalsScoredHome || 1.45;
      const awayConceded = features.avgGoalsConcededAway || features.avgGoalsScoredHome || 1.25;
      const awayScored = features.avgGoalsScoredAway || 1.15;
      const homeConceded = features.avgGoalsConcededHome || features.avgGoalsScoredAway || 1.25;

      const lambda = (homeScored + awayConceded) / 2;
      const mu = (awayScored + homeConceded) / 2;
      const G = lambda + mu;

      if (G > 0) {
        const pZeroHome = Math.exp(-lambda);
        const pZeroAway = Math.exp(-mu);
        
        // BTTS Rate: probability both score
        features.bttsRate = Number(((1 - pZeroHome) * (1 - pZeroAway)).toFixed(2));

        // Over/Under probabilities
        const pZeroTotal = Math.exp(-G);
        const pOneTotal = G * pZeroTotal;
        const pTwoTotal = (Math.pow(G, 2) / 2) * pZeroTotal;

        features.over15Rate = Number((1 - pZeroTotal - pOneTotal).toFixed(2));
        features.over25Rate = Number((1 - pZeroTotal - pOneTotal - pTwoTotal).toFixed(2));
        features.under25Rate = Number((1 - features.over25Rate).toFixed(2));
      }
    } else {
      // Baseline world football distribution priors when no data is available
      features.avgGoalsScoredHome = 1.45;
      features.avgGoalsScoredAway = 1.15;
      features.avgGoalsConcededHome = 1.15;
      features.avgGoalsConcededAway = 1.45;
      features.over15Rate = 0.76;
      features.over25Rate = 0.52;
      features.under25Rate = 0.48;
      features.bttsRate = 0.51;
      features.cleanSheetRateHome = 0.32;
      features.cleanSheetRateAway = 0.24;
      features.failedToScoreRateHome = 0.22;
      features.failedToScoreRateAway = 0.30;
    }
  }

  return features;
}
