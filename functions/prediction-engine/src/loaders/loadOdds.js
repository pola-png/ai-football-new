import { Query } from 'node-appwrite';

/**
 * Loads odds for a given fixture.
 * Attempts to load from the fixture_odds table.
 * Falls back to parsing fixtureDoc.odds_summary if table loading fails or is empty.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Odds table ID
 * @param {string} fixtureApiId - API fixture ID
 * @param {object} [fixtureDoc] - Optional fixture document to parse summary from
 * @returns {Promise<Array>} List of odds rows
 */
export async function loadOdds(tablesdb, databaseId, tableId, fixtureApiId, fixtureDoc = null) {
  try {
    // Try to load from the odds table
    const result = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [
        Query.equal('fixture_api_id', String(fixtureApiId)),
        Query.limit(500),
      ],
      total: false,
    });

    if (result.rows && result.rows.length > 0) {
      return result.rows;
    }
  } catch (error) {
    console.warn(`Could not load odds from table ${tableId} for fixture ${fixtureApiId}: ${error.message}. Checking backup options...`);
  }

  // Fallback to parsing odds_summary from fixtureDoc if provided
  if (fixtureDoc && fixtureDoc.odds_summary) {
    try {
      const parsed = JSON.parse(fixtureDoc.odds_summary);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (parseError) {
      console.error(`Error parsing odds_summary for fixture ${fixtureApiId}:`, parseError);
    }
  }

  return [];
}
