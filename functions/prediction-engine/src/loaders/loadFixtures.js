import { Query } from 'node-appwrite';

/**
 * Loads a single fixture by its API ID.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Fixtures table ID
 * @param {string} fixtureApiId - API fixture ID
 * @returns {Promise<object|null>} The fixture document or null if not found
 */
export async function loadFixture(tablesdb, databaseId, tableId, fixtureApiId) {
  try {
    const result = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [
        Query.equal('api_fixture_id', String(fixtureApiId)),
        Query.limit(1),
      ],
      total: false,
    });
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error loading fixture ${fixtureApiId}:`, error);
    return null;
  }
}

/**
 * Loads all fixtures for a given sync run.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} tableId - Fixtures table ID
 * @param {string} syncRunId - Sync run ID
 * @returns {Promise<Array>} List of fixtures in the sync run
 */
export async function loadFixturesBySyncRun(tablesdb, databaseId, tableId, syncRunId) {
  const rows = [];
  let offset = 0;
  const pageSize = 100;

  try {
    while (true) {
      const result = await tablesdb.listRows({
        databaseId,
        tableId,
        queries: [
          Query.equal('sync_run_id', String(syncRunId)),
          Query.orderAsc('$createdAt'),
          Query.limit(pageSize),
          Query.offset(offset),
        ],
        total: false,
      });

      const pageRows = result.rows || [];
      rows.push(...pageRows);

      if (pageRows.length < pageSize) {
        break;
      }
      offset += pageSize;
    }
    return rows;
  } catch (error) {
    console.error(`Error loading fixtures for sync run ${syncRunId}:`, error);
    return [];
  }
}
