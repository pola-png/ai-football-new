const { Client, TablesDB, ID, Query } = require('node-appwrite');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildClient() {
  const client = new Client();
  client
    .setEndpoint(required('APPWRITE_FUNCTION_ENDPOINT'))
    .setProject(required('APPWRITE_FUNCTION_PROJECT_ID'))
    .setKey(required('APPWRITE_FUNCTION_API_KEY'));
  return client;
}

function isoNow() {
  return new Date().toISOString();
}

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({
    databaseId,
    tableId,
    rowId: ID.unique(),
    data,
  });
}

async function deleteAllRows(tablesdb, databaseId, tableId) {
  return tablesdb.deleteRows({
    databaseId,
    tableId,
  });
}

async function fetchAllRows(tablesdb, databaseId, tableId, baseQueries, pageSize = 100) {
  const rows = [];
  let offset = 0;
  while (true) {
    const result = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [...baseQueries, Query.limit(pageSize), Query.offset(offset)],
      total: false,
    });
    const pageRows = result.rows || [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function normalizeRow(row) {
  if (row && row.data && typeof row.data === 'object') {
    return { ...row.data, $id: row.$id ?? row.data.$id ?? null };
  }
  return row;
}

// Backfill team names from fixtures into predictions that are missing them
async function backfillTeamNames(tablesdb, databaseId, fixturesTable, predictionsTable) {
  // Fetch all current fixtures
  const fixtures = await fetchAllRows(tablesdb, databaseId, fixturesTable, [
    Query.orderAsc('$createdAt'),
  ]);

  if (fixtures.length === 0) return 0;

  // Build a map of fixture_api_id -> team data
  const fixtureMap = new Map();
  for (const row of fixtures) {
    const data = normalizeRow(row);
    const id = String(data.api_fixture_id || '').trim();
    if (id) {
      fixtureMap.set(id, {
        home_team_name: data.home_team_name || null,
        away_team_name: data.away_team_name || null,
        home_team_logo_url: data.home_team_logo_url || null,
        away_team_logo_url: data.away_team_logo_url || null,
      });
    }
  }

  // Fetch predictions that are missing team names
  const predictions = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
    Query.orderAsc('$createdAt'),
  ]);

  let updated = 0;
  for (const row of predictions) {
    const data = normalizeRow(row);
    const rowId = data.$id;
    const fixtureApiId = String(data.fixture_api_id || '').trim();

    // Only update if team name is missing
    if (!rowId || !fixtureApiId) continue;
    if (data.home_team_name && data.away_team_name) continue;

    const fixture = fixtureMap.get(fixtureApiId);
    if (!fixture) continue;

    await tablesdb.updateRow({
      databaseId,
      tableId: predictionsTable,
      rowId,
      data: {
        home_team_name: data.home_team_name || fixture.home_team_name,
        away_team_name: data.away_team_name || fixture.away_team_name,
        home_team_logo_url: data.home_team_logo_url || fixture.home_team_logo_url,
        away_team_logo_url: data.away_team_logo_url || fixture.away_team_logo_url,
      },
    });
    updated += 1;
  }

  return updated;
}

async function main() {
  const client = buildClient();
  const tablesdb = new TablesDB(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');

  const startedAt = isoNow();

  try {
    // Backfill team names BEFORE deleting fixtures
    const backfilled = await backfillTeamNames(tablesdb, databaseId, fixturesTable, predictionsTable);

    const [fixtures, odds] = await Promise.all([
      deleteAllRows(tablesdb, databaseId, fixturesTable),
      deleteAllRows(tablesdb, databaseId, oddsTable),
    ]);

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'cleanup-raw-fetch',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: 0,
      items_saved: 0,
      message: `Backfilled team names for ${backfilled} predictions. Deleted raw fetch rows from fixtures and odds tables. Preserved h2h history.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return {
      ok: true,
      backfilled_team_names: backfilled,
      deleted: {
        fixtures: fixtures?.total ?? null,
        odds: odds?.total ?? null,
        h2h: 0,
      },
    };
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'cleanup-raw-fetch',
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: 0,
      items_saved: 0,
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    throw error;
  }
}

main().then(
  (result) => {
    console.log(JSON.stringify(result));
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
