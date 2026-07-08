const { Client, TablesDB, ID, Query } = require("node-appwrite");

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
  if (!value) throw new Error(`Missing required env var: ${name}`);
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
    "x-apisports-host": process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io",
  };
}

function buildApiFootballUrl(path, query = {}) {
  const url = new URL(`${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchApiFootballJson(path, query = {}) {
  const response = await fetch(buildApiFootballUrl(path, query).toString(), {
    headers: buildApiFootballHeaders(),
  });
  if (!response.ok) {
    throw new Error(`API-Football request failed with status ${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (offsetDays === 0) return dateStr;
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function safeIdPart(value) {
  return (
    String(value ?? "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "item"
  );
}

function buildTeamPairKey(homeTeamId, awayTeamId) {
  const home = String(homeTeamId || "").trim();
  const away = String(awayTeamId || "").trim();
  if (!home || !away) return null;
  return [home, away].sort().join("-");
}

function determineWinnerLabel(historicalFixture) {
  const homeWinner = historicalFixture?.teams?.home?.winner;
  const awayWinner = historicalFixture?.teams?.away?.winner;
  if (homeWinner === true) return "home";
  if (awayWinner === true) return "away";
  const homeGoals = historicalFixture?.goals?.home;
  const awayGoals = historicalFixture?.goals?.away;
  if (typeof homeGoals === "number" && typeof awayGoals === "number") {
    if (homeGoals > awayGoals) return "home";
    if (awayGoals > homeGoals) return "away";
    return "draw";
  }
  return null;
}

function pickTeam(team) {
  return {
    api_team_id: team.id != null ? String(team.id) : null,
    name: team.name,
    code: team.code || null,
    country: team.country || null,
    founded: team.founded != null ? String(team.founded) : null,
    national: Boolean(team.national),
    logo_url: team.logo || null,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

function pickLeague(league, season) {
  return {
    api_league_id: league.id != null ? String(league.id) : null,
    name: league.name,
    country: league.country || null,
    type: league.type || null,
    logo_url: league.logo || null,
    flag_url: league.flag || null,
    season: season != null ? String(season) : null,
    created_at: isoNow(),
    updated_at: isoNow(),
  };
}

function pickFixture(fixture, league, homeTeam, awayTeam) {
  const apiFixtureId = fixture.fixture?.id ?? fixture.id ?? null;
  return {
    api_fixture_id: apiFixtureId != null ? String(apiFixtureId) : null,
    league_api_id: league.id != null ? String(league.id) : null,
    season: league.season != null ? String(league.season) : null,
    round: fixture.league?.round || null,
    kickoff_at: fixture.fixture?.date || null,
    status_short: fixture.fixture?.status?.short || "NS",
    status_long: fixture.fixture?.status?.long || null,
    home_team_api_id: homeTeam.id != null ? String(homeTeam.id) : null,
    away_team_api_id: awayTeam.id != null ? String(awayTeam.id) : null,
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
    return await tablesdb.updateRow({ databaseId, tableId, rowId, data });
  } catch (error) {
    if (
      String(error?.code) !== "404" &&
      !String(error?.message || "").includes("Row not found")
    ) {
      throw error;
    }
    return tablesdb.createRow({ databaseId, tableId, rowId, data });
  }
}

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({ databaseId, tableId, rowId: ID.unique(), data });
}

// ─── Odds ────────────────────────────────────────────────────────────────────

async function fetchAndSaveOdds({ tablesdb, databaseId, oddsTable, fixtureApiId }) {
  const payload = await fetchApiFootballJson("/odds", { fixture: fixtureApiId });
  const entries = Array.isArray(payload?.response) ? payload.response : [];
  const now = isoNow();
  let saved = 0;

  for (const entry of entries) {
    for (const bookmaker of Array.isArray(entry?.bookmakers) ? entry.bookmakers : []) {
      for (const bet of Array.isArray(bookmaker?.bets) ? bookmaker.bets : []) {
        for (const value of Array.isArray(bet?.values) ? bet.values : []) {
          const selectionName = value?.value != null ? String(value.value) : null;
          if (!selectionName) continue;

          const rowId = `odds_${safeIdPart(fixtureApiId)}_${safeIdPart(bookmaker?.id ?? bookmaker?.name)}_${safeIdPart(bet?.name)}_${safeIdPart(selectionName)}`;
          await upsertRow(tablesdb, databaseId, oddsTable, rowId, {
            fixture_api_id: String(fixtureApiId),
            bookmaker_name: bookmaker?.name || null,
            bookmaker_api_id: bookmaker?.id != null ? String(bookmaker.id) : null,
            market_name: bet?.name || null,
            selection_name: selectionName,
            odd_value: value?.odd != null ? String(value.odd) : null,
            line_value:
              value?.handicap != null
                ? String(value.handicap)
                : value?.value != null
                  ? String(value.value)
                  : null,
            last_update_at: bookmaker?.last_update || entry?.update || null,
            created_at: now,
            updated_at: now,
          });
          saved += 1;
        }
      }
    }
  }

  return saved;
}

// ─── H2H ─────────────────────────────────────────────────────────────────────

function getH2hSeasonRange(fixtureSeason) {
  const historyYears = 7;
  const currentSeason = Number.parseInt(String(fixtureSeason || "").trim(), 10);
  const anchorYear = Number.isFinite(currentSeason)
    ? currentSeason
    : new Date().getFullYear();
  const startYear = Math.max(1900, anchorYear - historyYears + 1);
  const seasons = [];
  for (let y = startYear; y <= anchorYear; y += 1) seasons.push(y);
  return seasons;
}

async function fetchAndSaveH2H({
  tablesdb,
  databaseId,
  h2hTable,
  fixtureApiId,
  homeTeamId,
  awayTeamId,
  leagueApiId,
  season,
}) {
  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);
  if (!fixtureApiId || !homeTeamId || !awayTeamId) return 0;

  // Check if H2H already exists in the database for this pair
  const existing = await tablesdb.listRows({
    databaseId,
    tableId: h2hTable,
    queries: [Query.equal("current_fixture_api_id", String(fixtureApiId))],
    total: false,
  });
  if ((existing.rows || []).length > 0) {
    console.log(`H2H already cached for fixture ${fixtureApiId}, skipping.`);
    return 0;
  }

  const targetSeasons = getH2hSeasonRange(season);
  const now = isoNow();
  let saved = 0;

  for (const seasonYear of targetSeasons) {
    const requestQuery = {
      h2h: `${homeTeamId}-${awayTeamId}`,
      season: String(seasonYear),
      last: "20",
    };
    if (leagueApiId) requestQuery.league = leagueApiId;

    let payload;
    try {
      payload = await fetchApiFootballJson("/fixtures/headtohead", requestQuery);
    } catch (err) {
      console.log(`H2H fetch error for ${homeTeamId}-${awayTeamId} season ${seasonYear}: ${err.message}`);
      continue;
    }

    const historicalFixtures = Array.isArray(payload?.response) ? payload.response : [];
    for (const hf of historicalFixtures) {
      const hfId = hf?.fixture?.id ?? null;
      if (hfId == null) continue;

      const historicalFixtureId = String(hfId);
      const seasonLabel = String(hf?.league?.season ?? seasonYear);
      const compositeHistoricalId = `${pairKey || fixtureApiId}_${seasonLabel}_${historicalFixtureId}`;
      const homeGoals = hf?.goals?.home;
      const awayGoals = hf?.goals?.away;

      const rowId = `h2h_${safeIdPart(pairKey || fixtureApiId)}_${safeIdPart(seasonLabel)}_${safeIdPart(historicalFixtureId)}`;
      await upsertRow(tablesdb, databaseId, h2hTable, rowId, {
        current_fixture_api_id: String(fixtureApiId),
        historical_fixture_api_id: compositeHistoricalId,
        home_team_api_id: String(hf?.teams?.home?.id ?? homeTeamId),
        away_team_api_id: String(hf?.teams?.away?.id ?? awayTeamId),
        pair_key: pairKey,
        kickoff_at: hf?.fixture?.date || null,
        home_score: homeGoals != null ? String(homeGoals) : null,
        away_score: awayGoals != null ? String(awayGoals) : null,
        winner: determineWinnerLabel(hf),
        status_short: hf?.fixture?.status?.short || "NS",
        league_api_id: hf?.league?.id != null ? String(hf.league.id) : null,
        season: seasonLabel,
        created_at: now,
        updated_at: now,
      });
      saved += 1;
    }
  }

  return saved;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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
  const oddsTable = required("APPWRITE_TABLE_FIXTURE_ODDS");
  const h2hTable = required("APPWRITE_TABLE_FIXTURE_H2H_HISTORY");
  const syncRunsTable = required("APPWRITE_TABLE_SYNC_RUNS");

  const today = lagosDate(1);
  const league = process.env.API_FOOTBALL_LEAGUE
    ? Number(process.env.API_FOOTBALL_LEAGUE)
    : null;

  const url = new URL(
    `${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}/fixtures`,
  );
  url.searchParams.set("date", today);
  if (league) url.searchParams.set("league", String(league));

  const startedAt = isoNow();
  const syncRunId = `sync_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  let itemsSaved = 0;
  let oddsSaved = 0;
  let h2hSaved = 0;

  try {
    console.log(`Fetching fixtures for today: ${today}`);
    const response = await fetch(url.toString(), { headers: buildApiFootballHeaders() });

    if (!response.ok) {
      throw new Error(`API-Football request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];
    console.log(`Fetched ${fixtures.length} fixtures from API-Football.`);

    for (const fixture of fixtures) {
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;
      const fixtureApiId = String(fixture.fixture.id);

      console.log(`Processing: ${homeTeam.name} vs ${awayTeam.name} (${fixtureApiId})`);

      // 1. Save teams, league, fixture
      const teamRows = [
        { tableId: teamsTable, rowId: `team_${homeTeam.id}`, data: pickTeam(homeTeam) },
        { tableId: teamsTable, rowId: `team_${awayTeam.id}`, data: pickTeam(awayTeam) },
      ];
      const leagueRow = {
        tableId: leaguesTable,
        rowId: `league_${leagueInfo.id}_${fixture.league.season}`,
        data: pickLeague(leagueInfo, fixture.league.season ?? new Date().getFullYear()),
      };
      const fixtureRow = {
        tableId: fixturesTable,
        rowId: `fixture_${fixtureApiId}`,
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

      // 2. Fetch & save odds (200ms delay to stay under API rate limit)
      await sleep(200);
      try {
        const oddsCount = await fetchAndSaveOdds({
          tablesdb, databaseId, oddsTable, fixtureApiId,
        });
        oddsSaved += oddsCount;
        console.log(`Odds saved for ${fixtureApiId}: ${oddsCount} rows`);
      } catch (err) {
        console.log(`Odds error for ${fixtureApiId}: ${err.message}`);
      }

      // 3. Fetch & save H2H (200ms delay)
      await sleep(200);
      try {
        const h2hCount = await fetchAndSaveH2H({
          tablesdb,
          databaseId,
          h2hTable,
          fixtureApiId,
          homeTeamId: String(homeTeam.id),
          awayTeamId: String(awayTeam.id),
          leagueApiId: leagueInfo.id != null ? String(leagueInfo.id) : null,
          season: leagueInfo.season != null ? String(leagueInfo.season) : null,
        });
        h2hSaved += h2hCount;
        console.log(`H2H saved for ${fixtureApiId}: ${h2hCount} rows`);
      } catch (err) {
        console.log(`H2H error for ${fixtureApiId}: ${err.message}`);
      }
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: "sync-fixtures",
      sync_run_id: syncRunId,
      status: "success",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(itemsSaved),
      message: `Synced ${itemsSaved} fixtures, ${oddsSaved} odds rows, ${h2hSaved} H2H rows.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    if (res) {
      return res.json({ ok: true, items_seen: fixtures.length, items_saved: itemsSaved, odds_saved: oddsSaved, h2h_saved: h2hSaved });
    }
    return { ok: true, items_seen: fixtures.length, items_saved: itemsSaved, odds_saved: oddsSaved, h2h_saved: h2hSaved };

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
      return res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
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
  module.exports().then(
    (result) => nativeConsoleLog(JSON.stringify(result)),
    (error) => { nativeConsoleError(error); process.exit(1); },
  );
}
