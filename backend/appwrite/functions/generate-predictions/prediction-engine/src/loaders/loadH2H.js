import { Query } from 'node-appwrite';

/**
 * Loads head-to-head (H2H) history for a given fixture.
 * Attempts to load from the fixture_h2h_history table by current_fixture_api_id and pair_key.
 * Falls back to parsing fixtureDoc.h2h_summary if table loading fails or is empty.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - H2H table ID
 * @param {object} fixtureDoc - The fixture document
 * @returns {Promise<Array>} List of unique H2H history rows
 */
export async function loadH2H(tablesdb, databaseId, tableId, fixtureDoc) {
  const fixtureApiId = String(fixtureDoc?.api_fixture_id || '').trim();
  const homeTeamId = String(fixtureDoc?.home_team_api_id || '').trim();
  const awayTeamId = String(fixtureDoc?.away_team_api_id || '').trim();
  const pairKey = (homeTeamId && awayTeamId) ? [homeTeamId, awayTeamId].sort().join('-') : null;

  try {
    const currentFixtureRows = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [
        Query.equal('current_fixture_api_id', fixtureApiId),
        Query.orderAsc('$createdAt'),
        Query.limit(100),
      ],
      total: false,
    }).then(res => res.rows || []);

    let pairRows = [];
    if (pairKey) {
      pairRows = await tablesdb.listRows({
        databaseId,
        tableId,
        queries: [
          Query.equal('pair_key', pairKey),
          Query.orderAsc('$createdAt'),
          Query.limit(100),
        ],
        total: false,
      }).then(res => res.rows || []);
    }

    const rowsByHistoricalId = new Map();
    for (const row of [...currentFixtureRows, ...pairRows]) {
      const key = String(
        row?.historical_fixture_api_id
        || row?.$id
        || `${row?.kickoff_at || ''}_${row?.home_score || ''}_${row?.away_score || ''}`
      ).trim();
      if (!key || rowsByHistoricalId.has(key)) {
        continue;
      }
      rowsByHistoricalId.set(key, row);
    }

    const h2hRows = [...rowsByHistoricalId.values()];
    if (h2hRows.length > 0) {
      return h2hRows;
    }
  } catch (error) {
    console.warn(`Could not load H2H from table ${tableId} for fixture ${fixtureApiId}: ${error.message}. Checking backup options...`);
  }

  // Fallback to parsing h2h_summary from fixtureDoc if provided
  if (fixtureDoc && fixtureDoc.h2h_summary) {
    try {
      const parsed = JSON.parse(fixtureDoc.h2h_summary);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (parseError) {
      console.error(`Error parsing h2h_summary for fixture ${fixtureApiId}:`, parseError);
    }
  }

  return [];
}
