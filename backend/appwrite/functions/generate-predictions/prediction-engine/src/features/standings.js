/**
 * Extracts standings-related features.
 * @param {Array} standingsList - Standings rows loaded from Appwrite
 * @param {string} homeTeamApiId - Home team API ID
 * @param {string} awayTeamApiId - Away team API ID
 * @returns {object} Standings features
 */
export function extractStandingsFeatures(standingsList = [], homeTeamApiId = '', awayTeamApiId = '') {
  const features = {
    homeRank: null,
    awayRank: null,
    rankDifference: 0, // Home Rank - Away Rank (negative means home is ranked higher/better)
    homePoints: 0,
    awayPoints: 0,
    pointsDifference: 0, // Home Points - Away Points
    isHomeHigherRanked: false,
    hasStandings: false,
  };

  if (!standingsList || standingsList.length === 0) {
    return features;
  }

  // Parse standard API-Football standing structure
  // Usually standings is a nested array: standing[0] is group/table
  // Let's flatten any deep list if necessary or search for our teams
  let flatStandings = [];
  
  if (Array.isArray(standingsList)) {
    // If the list contains rows that are already flat documents
    if (standingsList[0]?.rank !== undefined) {
      flatStandings = standingsList;
    } else {
      // Try to traverse nested structures e.g. from raw payload
      for (const item of standingsList) {
        if (item.standings && Array.isArray(item.standings)) {
          flatStandings.push(...item.standings.flat());
        } else if (Array.isArray(item)) {
          flatStandings.push(...item);
        }
      }
    }
  }

  let homeRow = null;
  let awayRow = null;

  for (const row of flatStandings) {
    const teamId = String(row.team_api_id || row.team?.id || row.team?.api_team_id || '').trim();
    if (teamId === String(homeTeamApiId)) {
      homeRow = row;
    } else if (teamId === String(awayTeamApiId)) {
      awayRow = row;
    }
  }

  if (homeRow && awayRow) {
    features.hasStandings = true;
    features.homeRank = Number(homeRow.rank);
    features.awayRank = Number(awayRow.rank);
    features.homePoints = Number(homeRow.points || homeRow.points_total || 0);
    features.awayPoints = Number(awayRow.points || awayRow.points_total || 0);

    features.rankDifference = features.homeRank - features.awayRank;
    features.pointsDifference = features.homePoints - features.awayPoints;
    features.isHomeHigherRanked = features.homeRank < features.awayRank; // lower rank is better (e.g. 1st vs 10th)
  }

  return features;
}
