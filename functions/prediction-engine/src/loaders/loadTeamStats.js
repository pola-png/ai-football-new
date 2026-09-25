import { Query } from '../db/query.js';

/**
 * Loads team statistics for a given team, league, and season.
 * Gracefully handles missing collections by returning null, allowing features
 * to be derived from historical data.
 * @param {object} tablesdb - Firestore Database instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Optional team stats table ID
 * @param {string} teamApiId - API team ID
 * @param {string} leagueApiId - API league ID
 * @param {string} season - League season
 * @returns {Promise<object|null>} The team statistics record or null if not found
 */
export async function loadTeamStats(tablesdb, databaseId, tableId, teamApiId, leagueApiId, season, cache = null) {
  const actualTableId = tableId || process.env.TABLE_TEAM_STATS || process.env.APPWRITE_TABLE_TEAM_STATS || 'team_statistics';
  if (!actualTableId) {
    return null;
  }

  if (cache && cache.has(`missing_table_${actualTableId}`)) {
    return null;
  }

  const cacheKey = `teamstats_${actualTableId}_${teamApiId}_${leagueApiId}_${season}`;
  if (cache && cache.has(cacheKey)) {
    return cache.get(cacheKey);
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
    const record = result.rows[0] || null;
    if (cache) {
      cache.set(cacheKey, record);
    }
    return record;
  } catch (error) {
    console.warn(`Could not load team stats from collection ${actualTableId}: ${error.message}. Returning null.`);
    if (cache) {
      const isNotFound = error.code === 404 ||
        (error.message && (
          error.message.includes('not be found') ||
          error.message.includes('not found') ||
          error.message.includes('Collection not found')
        ));
      if (isNotFound) {
        cache.set(`missing_table_${actualTableId}`, true);
      }
    }
    return null;
  }
}
