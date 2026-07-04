const { Client, TablesDB, ID } = require("node-appwrite");

const nativeConsoleLog = console.log;
const nativeConsoleWarn = console.warn;
const nativeConsoleError = console.error;
const nativeConsoleInfo = console.info;

function buildAppwriteLogger(context) {
  const log =
    typeof context?.log === "function"
      ? (message) => context.log(message)
      : (message) => nativeConsoleLog(message);
  const error =
    typeof context?.error === "function"
      ? (message) => context.error(message)
      : (message) => nativeConsoleError(message);

  return { log, error };
}

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
    .setEndpoint(required("APPWRITE_FUNCTION_ENDPOINT"))
    .setProject(required("APPWRITE_FUNCTION_PROJECT_ID"))
    .setKey(required("APPWRITE_FUNCTION_API_KEY"));

  return client;
}

function buildApiFootballHeaders() {
  return {
    "x-apisports-key": required("API_FOOTBALL_KEY"),
    "x-apisports-host":
      process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io",
  };
}

function isoNow() {
  return new Date().toISOString();
}

function lagosDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  if (offsetDays === 0) {
    return dateStr;
  }
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function pickTeam(team) {
  return {
    api_team_id: team.id,
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
    api_league_id: league.id,
    name: league.name,
    country: league.country || null,
    type: league.type || null,
    logo_url: league.logo || null,
    flag_url: league.flag || null,
    season,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

function pickFixture(fixture, league, homeTeam, awayTeam) {
  return {
    api_fixture_id: fixture.id,
    league_api_id: league.id,
    season: league.season,
    round: fixture.league?.round || null,
    kickoff_at: fixture.fixture?.date || null,
    status_short: fixture.fixture?.status?.short || "NS",
    status_long: fixture.fixture?.status?.long || null,
    home_team_api_id: homeTeam.id,
    away_team_api_id: awayTeam.id,
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

async function upsertRow(tablesdb, databaseId, tableId, rowId, data) {
  try {
    return await tablesdb.updateRow({
      databaseId,
      tableId,
      rowId,
      data,
    });
  } catch (error) {
    if (
      String(error?.code) !== "404" &&
      !String(error?.message || "").includes("Row not found")
    ) {
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

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({
    databaseId,
    tableId,
    rowId: ID.unique(),
    data,
  });
}

module.exports = async function main(context) {
  const { res } = context || {};
  const { log: appwriteLog, error: appwriteError } = buildAppwriteLogger(context);

  console.log = appwriteLog;
  console.info = appwriteLog;
  console.warn = appwriteLog;
  console.error = appwriteError;

  const client = buildClient();
  const tablesdb = new TablesDB(client);

  const databaseId = required("APPWRITE_DATABASE_ID");
  const teamsTable = required("APPWRITE_TABLE_TEAMS");
  const leaguesTable = required("APPWRITE_TABLE_LEAGUES");
  const fixturesTable = required("APPWRITE_TABLE_FIXTURES");
  const syncRunsTable = required("APPWRITE_TABLE_SYNC_RUNS");

  const today = lagosDate(0);
  const league = process.env.API_FOOTBALL_LEAGUE
    ? Number(process.env.API_FOOTBALL_LEAGUE)
    : null;

  const url = new URL(
    `${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}/fixtures`,
  );
  url.searchParams.set("date", today);
  if (league) {
    url.searchParams.set("league", String(league));
  }

  const startedAt = isoNow();
  const syncRunId = `sync_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  let itemsSaved = 0;

  try {
    console.log(`Fetching fixtures for today: ${today}`);
    const response = await fetch(url.toString(), {
      headers: buildApiFootballHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `API-Football request failed with status ${response.status}`,
      );
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];
    console.log(`Fetched ${fixtures.length} fixtures from API-Football.`);

    for (const fixture of fixtures) {
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;

      console.log(
        `Saving fixture: ${homeTeam.name} vs ${awayTeam.name} (${fixture.fixture.id})`,
      );

      const teamRows = [
        {
          tableId: teamsTable,
          rowId: `team_${homeTeam.id}`,
          data: pickTeam(homeTeam),
        },
        {
          tableId: teamsTable,
          rowId: `team_${awayTeam.id}`,
          data: pickTeam(awayTeam),
        },
      ];

      const leagueRow = {
        tableId: leaguesTable,
        rowId: `league_${leagueInfo.id}_${fixture.league.season}`,
        data: pickLeague(
          leagueInfo,
          fixture.league.season ?? new Date().getFullYear(),
        ),
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
      job_name: "sync-fixtures",
      sync_run_id: syncRunId,
      status: "success",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(itemsSaved),
      message: `Synced ${itemsSaved} fixtures from API-Football.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    if (res) {
      return res.json({
        ok: true,
        items_seen: fixtures.length,
        items_saved: itemsSaved,
      });
    }

    return {
      ok: true,
      items_seen: fixtures.length,
      items_saved: itemsSaved,
    };
  } catch (error) {
    console.error(`Error during sync-fixtures: ${error.message}`);
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: "sync-fixtures",
      sync_run_id: syncRunId,
      status: "failed",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(itemsSaved),
      items_saved: String(itemsSaved),
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    if (res) {
      return res.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    throw error;
  } finally {
    console.log = nativeConsoleLog;
    console.warn = nativeConsoleWarn;
    console.error = nativeConsoleError;
    console.info = nativeConsoleInfo;
  }
};

if (process.env.APPWRITE_FUNCTION_ID === undefined) {
  main().then(
    (result) => {
      console.log(JSON.stringify(result));
    },
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
