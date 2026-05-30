import { Client, TablesDB, ID } from 'node-appwrite';

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

function buildApiFootballHeaders() {
  return {
    'x-apisports-key': required('API_FOOTBALL_KEY'),
    'x-apisports-host': process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io',
  };
}

function isoNow() {
  return new Date().toISOString();
}

function lagosDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({
    databaseId,
    tableId,
    rowId: ID.unique(),
    data,
  });
}

async function upsertRow(tablesdb, databaseId, tableId, rowId, data) {
  try {
    return await tablesdb.updateRow({
      databaseId,
      tableId,
      rowId,
      data,
    });
  } catch (error) {
    if (String(error?.code) !== '404' && !String(error?.message || '').includes('Row not found')) {
      throw error;
    }
    return tablesdb.createRow({
      databaseId,
      tableId,
      rowId,
      data,
    });
  }
}

async function deleteAllRows(tablesdb, databaseId, tableId) {
  return tablesdb.deleteRows({
    databaseId,
    tableId,
  });
}

function pickTeam(team) {
  return {
    api_team_id: String(team.id),
    name: team.name,
    code: team.code || null,
    country: team.country || null,
    founded: team.founded || null,
    national: Boolean(team.national),
    logo_url: team.logo || null,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

function pickLeague(league, season) {
  return {
    api_league_id: String(league.id),
    name: league.name,
    country: league.country || null,
    type: league.type || null,
    logo_url: league.logo || null,
    flag_url: league.flag || null,
    season: String(season),
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

function pickFixture(fixture, league, homeTeam, awayTeam) {
  const apiFixtureId = fixture.fixture?.id ?? fixture.id ?? null;

  return {
    api_fixture_id: apiFixtureId != null ? String(apiFixtureId) : null,
    league_api_id: String(league.id),
    season: String(league.season),
    round: fixture.league?.round || null,
    kickoff_at: fixture.fixture?.date || null,
    status_short: fixture.fixture?.status?.short || 'NS',
    status_long: fixture.fixture?.status?.long || null,
    home_team_api_id: String(homeTeam.id),
    away_team_api_id: String(awayTeam.id),
    home_team_name: homeTeam.name,
    away_team_name: awayTeam.name,
    home_team_logo_url: homeTeam.logo || null,
    away_team_logo_url: awayTeam.logo || null,
    venue_name: fixture.fixture?.venue?.name || null,
    venue_city: fixture.fixture?.venue?.city || null,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

export default async function main({ res, error: reportError }) {
  const client = buildClient();
  const tablesdb = new TablesDB(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const teamsTable = required('APPWRITE_TABLE_TEAMS');
  const leaguesTable = required('APPWRITE_TABLE_LEAGUES');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');

  const league = process.env.API_FOOTBALL_LEAGUE ? Number(process.env.API_FOOTBALL_LEAGUE) : null;
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate();

  const url = new URL(`${required('API_FOOTBALL_BASE_URL').replace(/\/$/, '')}/fixtures`);
  url.searchParams.set('date', fetchDate);
  if (league) {
    url.searchParams.set('league', String(league));
  }

  const startedAt = isoNow();
  const syncRunId = `sync_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  let cleanupCompleted = false;
  let syncCompleted = false;
  let itemsSaved = 0;

  try {
    const [fixturesDelete, oddsDelete, h2hDelete] = await Promise.all([
      deleteAllRows(tablesdb, databaseId, fixturesTable),
      deleteAllRows(tablesdb, databaseId, oddsTable),
      deleteAllRows(tablesdb, databaseId, h2hTable),
    ]);

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'cleanup-raw-fetch',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: '0',
      items_saved: '0',
      message: 'Deleted all raw fetch rows before the next sync cycle.',
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    cleanupCompleted = true;

    const response = await fetch(url.toString(), {
      headers: buildApiFootballHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API-Football request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];

    for (const fixture of fixtures) {
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;

      const teamRows = [
        { tableId: teamsTable, rowId: `team_${homeTeam.id}`, data: pickTeam(homeTeam) },
        { tableId: teamsTable, rowId: `team_${awayTeam.id}`, data: pickTeam(awayTeam) },
      ];

      const leagueRow = {
        tableId: leaguesTable,
        rowId: `league_${leagueInfo.id}_${fixture.league.season}`,
        data: pickLeague(leagueInfo, fixture.league.season),
      };

      const fixtureRow = {
        tableId: fixturesTable,
        rowId: `fixture_${fixture.fixture.id}`,
        data: {
          ...pickFixture(fixture, leagueInfo, homeTeam, awayTeam),
          sync_run_id: syncRunId,
          processed: false,
          processed_at: null,
          delete_after_at: null,
        },
      };

      for (const row of [...teamRows, leagueRow, fixtureRow]) {
        await upsertRow(tablesdb, databaseId, row.tableId, row.rowId, row.data);
      }

      itemsSaved += 1;
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'sync-fixtures',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(itemsSaved),
      message: `Synced ${itemsSaved} fixtures from API-Football.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    syncCompleted = true;

    return res.json({
      ok: true,
      cleaned: {
        fixtures: fixturesDelete?.total ?? null,
        odds: oddsDelete?.total ?? null,
        h2h: h2hDelete?.total ?? null,
      },
      items_seen: String(fixtures.length),
      items_saved: String(itemsSaved),
      sync_run_id: syncRunId,
    });
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: cleanupCompleted ? 'sync-fixtures' : 'cleanup-raw-fetch',
      sync_run_id: syncRunId,
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(syncCompleted ? itemsSaved : 0),
      items_saved: String(syncCompleted ? itemsSaved : 0),
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    reportError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
