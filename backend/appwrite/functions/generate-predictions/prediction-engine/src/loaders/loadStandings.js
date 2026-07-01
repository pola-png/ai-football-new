import { Query } from 'node-appwrite';

/**
 * Loads standings for a given league and season.
 * Gracefully handles missing collections by returning an empty list, allowing features
 * to be derived from historical H2H data.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Optional standings table ID (defaults to APPWRITE_TABLE_STANDINGS env var)
 * @param {string} leagueApiId - API league ID
 * @param {string} season - League season
 * @returns {Promise<Array>} List of standings records
 */
export async function loadStandings(tablesdb, databaseId, tableId, leagueApiId, season) {
  const actualTableId = tableId || process.env.APPWRITE_TABLE_STANDINGS;
  if (!actualTableId) {
    console.warn('APPWRITE_TABLE_STANDINGS environment variable is not defined. Returning fallback standings.');
    return [];
  }

  try {
    const result = await tablesdb.listRows({
      databaseId,
      tableId: actualTableId,
      queries: [
        Query.equal('league_api_id', String(leagueApiId)),
        Query.equal('season', String(season)),
        Query.limit(100),
      ],
      total: false,
    });
    return result.rows || [];
  } catch (error) {
    console.warn(`Could not load standings from collection ${actualTableId}: ${error.message}. Returning empty standings array.`);
    return [];
  }
}
