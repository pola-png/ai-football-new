import { Query } from 'node-appwrite';

/**
 * Loads team statistics for a given team, league, and season.
 * Gracefully handles missing collections by returning null, allowing features
 * to be derived from historical H2H data.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Optional team stats table ID (defaults to APPWRITE_TABLE_TEAM_STATS env var)
 * @param {string} teamApiId - API team ID
 * @param {string} leagueApiId - API league ID
 * @param {string} season - League season
 * @returns {Promise<object|null>} The team statistics record or null if not found
 */
export async function loadTeamStats(tablesdb, databaseId, tableId, teamApiId, leagueApiId, season) {
  const actualTableId = tableId || process.env.APPWRITE_TABLE_TEAM_STATS;
  if (!actualTableId) {
    console.warn('APPWRITE_TABLE_TEAM_STATS environment variable is not defined. Returning fallback stats.');
    return null;
  }

  try {
    const result = await tablesdb.listRows({
      databaseId,
      tableId: actualTableId,
      queries: [
        Query.equal('team_api_id', String(teamApiId)),
        Query.equal('league_api_id', String(leagueApiId)),
        Query.equal('season', String(season)),
        Query.limit(1),
      ],
      total: false,
    });
    return result.rows[0] || null;
  } catch (error) {
    console.warn(`Could not load team stats from collection ${actualTableId}: ${error.message}. Returning null.`);
    return null;
  }
}
