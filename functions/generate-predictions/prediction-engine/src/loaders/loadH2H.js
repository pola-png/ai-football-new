import { Query, ID } from '../db/query.js';
import { searchH2HOnline } from './webSearchH2H.js';

/**
 * Loads head-to-head (H2H) history for a given fixture.
 * 1. Attempts to load from the fixture_h2h_history collection/table by current_fixture_api_id and pair_key.
 * 2. Falls back to parsing fixtureDoc.h2h_summary if table loading fails or is empty.
 * 3. Falls back to automated web search (no external API) to extract match results and auto-caches them.
 * @param {object} tablesdb - Firestore Database instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - H2H collection/table ID
 * @param {object} fixtureDoc - The fixture document
 * @returns {Promise<Array>} List of unique H2H history rows
 */
export async function loadH2H(tablesdb, databaseId, tableId, fixtureDoc) {
  const fixtureApiId = String(fixtureDoc?.api_fixture_id || '').trim();
  const homeTeamId = String(fixtureDoc?.home_team_api_id || '').trim();
  const awayTeamId = String(fixtureDoc?.away_team_api_id || '').trim();
  const homeTeamName = String(fixtureDoc?.home_team_name || '').trim();
  const awayTeamName = String(fixtureDoc?.away_team_name || '').trim();
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

  // Fallback 1: Parsing h2h_summary from fixtureDoc if provided
  if (fixtureDoc && fixtureDoc.h2h_summary) {
    try {
      const parsed = JSON.parse(fixtureDoc.h2h_summary);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (parseError) {
      console.error(`Error parsing h2h_summary for fixture ${fixtureApiId}:`, parseError);
    }
  }

  // Fallback 2: Automated Web Search (No API required)
  if (homeTeamName && awayTeamName) {
    try {
      const webMatches = await searchH2HOnline(homeTeamName, awayTeamName);
      if (webMatches.length > 0) {
        const formattedRows = webMatches.map((m, index) => ({
          historical_fixture_api_id: `web_${fixtureApiId}_${index}`,
          current_fixture_api_id: fixtureApiId,
          pair_key: pairKey || `${homeTeamName}-${awayTeamName}`,
          home_team_name: homeTeamName,
          away_team_name: awayTeamName,
          home_team_api_id: homeTeamId || null,
          away_team_api_id: awayTeamId || null,
          home_score: String(m.home_score),
          away_score: String(m.away_score),
          winner: m.winner,
          kickoff_at: m.kickoff_at || new Date().toISOString(),
          status_short: m.status_short || 'FT',
          source: m.source || 'web_search',
          created_at: new Date().toISOString(),
        }));

        // Cache in background to table so subsequent queries hit the database directly
        if (tablesdb && typeof tablesdb.createRow === 'function' && tableId) {
          Promise.allSettled(
            formattedRows.map(row =>
              tablesdb.createRow({
                databaseId,
                tableId,
                rowId: ID.unique(),
                data: row,
              })
            )
          ).catch(() => {});
        }

        return formattedRows;
      }
    } catch (webErr) {
      console.warn(`Web search H2H fallback encountered an error: ${webErr.message}`);
    }
  }

  return [];
}
