import { Client, ID, Query, TablesDB } from "node-appwrite";

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

function buildAppwriteLogger(context) {
  const log =
    typeof context?.log === "function"
      ? (message) => context.log(message)
      : (message) => console.log(message);
  const error =
    typeof context?.error === "function"
      ? (message) => context.error(message)
      : (message) => console.error(message);

  return { log, error };
}

// Top leagues by API-Football ID that get a popularity bonus
const POPULAR_LEAGUE_IDS = new Set([
  39, // Premier League
  140, // La Liga
  135, // Serie A
  78, // Bundesliga
  61, // Ligue 1
  94, // Primeira Liga
  88, // Eredivisie
  203, // Super Lig
  144, // Jupiler Pro League
  71, // Brasileirao
  128, // Argentine Primera Division
  2, // UEFA Champions League
  3, // UEFA Europa League
  848, // UEFA Conference League
  1, // World Cup
  4, // Euro Championship
]);

const WORLD_CUP_LEAGUE_ID = 1;

function isWorldCupCompetitionName(value) {
  const text = String(value || "").toLowerCase();
  return (
    text.includes("world cup") ||
    text.includes("fifa world cup") ||
    text.includes("women's world cup") ||
    text.includes("womens world cup")
  );
}

function popularityBonus(leagueId, leagueName = "") {
  const id = Number(leagueId);
  if (Number.isFinite(id) && POPULAR_LEAGUE_IDS.has(id)) {
    return 30;
  }

  return isWorldCupCompetitionName(leagueName) ? 30 : 0;
}

function isCountryMatch(fixture) {
  return Boolean(
    fixture?.teams?.home?.national ||
      fixture?.teams?.away?.national ||
      isWorldCupCompetitionName(fixture?.league?.name),
  );
}

function countOddsSignalsLocal(oddsRows) {
  let signals = 0;
  for (const row of Array.isArray(oddsRows) ? oddsRows : []) {
    const market = String(row?.market_name || "").toLowerCase();
    const sel = String(row?.selection_name || "").toLowerCase();
    if (
      market.includes("over") ||
      market.includes("under") ||
      market.includes("btts") ||
      market.includes("both teams") ||
      market.includes("double chance") ||
      market.includes("corner") ||
      market.includes("throw") ||
      sel.includes("over") ||
      sel.includes("under") ||
      sel.includes("yes") ||
      sel.includes("no")
    )
      signals += 1;
  }
  return signals;
}

function scoreFixture({ oddsRows, h2hRows, leagueId, leagueName, isCountry }) {
  let score = 0;
  const reasons = [];

  const oddsCount = Array.isArray(oddsRows) ? oddsRows.length : 0;
  if (oddsCount > 0) {
    score += 20;
    reasons.push("odds-present");
    const signals = countOddsSignalsLocal(oddsRows);
    if (signals > 0) {
      score += Math.min(20, signals * 5);
      reasons.push("good-odds-signals");
    }
  }

  const bonus = popularityBonus(leagueId);
  if (bonus > 0) {
    score += bonus;
    reasons.push("popular-league");
  }

  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  if (h2hCount > 0) {
    score += Math.min(35, 10 + h2hCount * 3);
    reasons.push("has-h2h");
  }

  if (isCountry || isWorldCupCompetitionName(leagueName)) {
    score += 40;
    reasons.push("country-match");
  }

  return { score, reasons };
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
  const base = new Date(
    Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)),
  );
  base.setUTCDate(base.getUTCDate() + offsetDays);

  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, "0");
  const day = String(base.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseFixtureKickoff(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimeZoneHour(value, timeZone = "Africa/Lagos") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(value);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number.parseInt(map.hour, 10);
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
    return await tablesdb.updateRow({ databaseId, tableId, rowId, data });
  } catch (error) {
    const isNotFound =
      String(error?.code) === "404" ||
      String(error?.message || "").includes("Row not found") ||
      String(error?.message || "").includes("Document not found");
    if (!isNotFound) {
      throw error;
    }
    try {
      return await tablesdb.createRow({ databaseId, tableId, rowId, data });
    } catch (createError) {
      const isAlreadyExists =
        String(createError?.code) === "409" ||
        String(createError?.message || "").includes("already exists") ||
        String(createError?.message || "").includes("Document already exists");
      if (isAlreadyExists) {
        return await tablesdb.updateRow({ databaseId, tableId, rowId, data });
      }
      throw createError;
    }
  }
}

async function deleteAllRows(tablesdb, databaseId, tableId) {
  return tablesdb.deleteRows({
    databaseId,
    tableId,
  });
}

function toLagosDateKey(value) {
  const parsed = parseFixtureKickoff(value);
  if (!parsed) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function deletePredictionRowsOutsideWindow(
  tablesdb,
  databaseId,
  predictionsTable,
  logger,
) {
  const keepDates = new Set([lagosDate(-1), lagosDate(0), lagosDate(1)]);
  const rows = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
    Query.orderAsc("kickoff_at"),
  ]);
  const rowsToDelete = rows.filter(
    (row) => !keepDates.has(toLagosDateKey(row.kickoff_at)),
  );
  let deleted = 0;

  if (typeof logger === "function") {
    logger(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "prediction-cleanup-start",
        total_predictions: rows.length,
        keep_dates: [...keepDates],
        delete_candidates: rowsToDelete.length,
      }),
    );
  }

  for (const row of rowsToDelete) {
    if (!row?.$id) {
      continue;
    }

    await tablesdb.deleteRow({
      databaseId,
      tableId: predictionsTable,
      rowId: row.$id,
    });
    deleted += 1;
  }

  if (typeof logger === "function") {
    logger(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "prediction-cleanup-complete",
        total_predictions: rows.length,
        deleted_predictions: deleted,
        kept_dates: [...keepDates],
      }),
    );
  }

  return {
    total: rows.length,
    deleted,
    keptDates: [...keepDates],
  };
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
    venue: team.venue?.name || team.venue || null,
    last_synced_at: isoNow(),
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
    status_short: fixture.fixture?.status?.short || "NS",
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

function buildApiFootballUrl(path, query = {}) {
  const url = new URL(
    `${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}${path}`,
  );
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
    throw new Error(
      `API-Football request failed with status ${response.status}`,
    );
  }

  const payload = await response.json();
  if (payload?.errors) {
    const hasErrors = Array.isArray(payload.errors)
      ? payload.errors.length > 0
      : Object.keys(payload.errors).length > 0;
    if (hasErrors) {
      throw new Error(`API-Football error: ${JSON.stringify(payload.errors)}`);
    }
  }
  return payload;
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

function determineWinnerLabel(historicalFixture) {
  const homeWinner = historicalFixture?.teams?.home?.winner;
  const awayWinner = historicalFixture?.teams?.away?.winner;

  if (homeWinner === true) {
    return "home";
  }

  if (awayWinner === true) {
    return "away";
  }

  const homeGoals = historicalFixture?.goals?.home;
  const awayGoals = historicalFixture?.goals?.away;
  if (typeof homeGoals === "number" && typeof awayGoals === "number") {
    if (homeGoals > awayGoals) {
      return "home";
    }
    if (awayGoals > homeGoals) {
      return "away";
    }
    return "draw";
  }

  return null;
}

function buildTeamPairKey(homeTeamId, awayTeamId) {
  const home = String(homeTeamId || "").trim();
  const away = String(awayTeamId || "").trim();
  if (!home || !away) {
    return null;
  }

  return [home, away].sort().join("-");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getH2hSeasonRange(fixtureSeason) {
  const historyYears = parsePositiveInteger(
    process.env.H2H_HISTORY_YEARS || "7",
    7,
  );
  const currentSeason = Number.parseInt(String(fixtureSeason || "").trim(), 10);
  const anchorYear = Number.isFinite(currentSeason)
    ? currentSeason
    : new Date().getFullYear();
  const startYear = Math.max(1900, anchorYear - historyYears + 1);
  const seasons = [];

  for (let seasonYear = startYear; seasonYear <= anchorYear; seasonYear += 1) {
    seasons.push(seasonYear);
  }

  return seasons;
}

async function fetchH2hRowsForPair(
  tablesdb,
  databaseId,
  h2hTable,
  fixtureApiId,
  homeTeamId,
  awayTeamId,
) {
  const fixtureRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal("current_fixture_api_id", String(fixtureApiId)),
    Query.orderAsc("$createdAt"),
  ]);

  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);
  if (!pairKey) {
    return fixtureRows;
  }

  const pairRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal("pair_key", pairKey),
    Query.orderAsc("$createdAt"),
  ]);

  const byHistoricalId = new Map();
  for (const row of [...fixtureRows, ...pairRows]) {
    const key = String(row?.historical_fixture_api_id || row?.$id || "").trim();
    if (!key || byHistoricalId.has(key)) {
      continue;
    }
    byHistoricalId.set(key, row);
  }

  return [...byHistoricalId.values()];
}

async function saveFixtureH2HHistory({
  tablesdb,
  databaseId,
  h2hTable,
  fixture,
  prefetchedH2HFixtures,
  logger,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || "").trim();
  const homeTeamId = String(fixture.home_team_api_id || "").trim();
  const awayTeamId = String(fixture.away_team_api_id || "").trim();
  const season = String(fixture.season || "").trim();
  const log = typeof logger === "function" ? logger : console.log;
  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);

  if (!fixtureApiId || !homeTeamId || !awayTeamId) {
    return 0;
  }

  // Use pre-fetched data when available, otherwise fetch from API
  let historicalFixturesToSave;
  if (
    Array.isArray(prefetchedH2HFixtures) &&
    prefetchedH2HFixtures.length > 0
  ) {
    historicalFixturesToSave = prefetchedH2HFixtures;
    log(
      JSON.stringify({
        job: "daily-sync-generate",
        fixture_api_id: fixtureApiId,
        stage: "h2h-prefetched",
        count: historicalFixturesToSave.length,
      }),
    );
  } else {
    const existingRows = await fetchH2hRowsForPair(
      tablesdb,
      databaseId,
      h2hTable,
      fixtureApiId,
      homeTeamId,
      awayTeamId,
    );
    if (existingRows.length > 0) {
      log(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixtureApiId,
          stage: "h2h-cached",
          pair_key: pairKey,
          count: existingRows.length,
        }),
      );
      return 0;
    }

    const targetSeasons = getH2hSeasonRange(season);
    historicalFixturesToSave = [];
    for (const seasonYear of targetSeasons) {
      const requestQuery = {
        h2h: `${homeTeamId}-${awayTeamId}`,
        season: String(seasonYear),
        last: "20",
      };
      if (fixture.league_api_id) requestQuery.league = fixture.league_api_id;
      const payload = await fetchApiFootballJson(
        "/fixtures/headtohead",
        requestQuery,
      );
      historicalFixturesToSave.push(
        ...(Array.isArray(payload?.response) ? payload.response : []),
      );
    }
  }

  const now = isoNow();
  let saved = 0;

  for (const historicalFixture of historicalFixturesToSave) {
    const historicalFixtureApiId = historicalFixture?.fixture?.id ?? null;
    if (historicalFixtureApiId == null) continue;

    const historicalFixtureId = String(historicalFixtureApiId);
    const homeGoals = historicalFixture?.goals?.home;
    const awayGoals = historicalFixture?.goals?.away;
    const seasonLabel = String(historicalFixture?.league?.season ?? season);
    const compositeHistoricalId = `${pairKey || fixtureApiId}_${seasonLabel}_${historicalFixtureId}`;

    await upsertRow(
      tablesdb,
      databaseId,
      h2hTable,
      `h2h_${safeIdPart(pairKey || fixtureApiId)}_${safeIdPart(seasonLabel)}_${safeIdPart(historicalFixtureId)}`,
      {
        current_fixture_api_id: fixtureApiId,
        historical_fixture_api_id: compositeHistoricalId,
        home_team_api_id: String(
          historicalFixture?.teams?.home?.id ?? homeTeamId,
        ),
        away_team_api_id: String(
          historicalFixture?.teams?.away?.id ?? awayTeamId,
        ),
        pair_key: pairKey,
        kickoff_at: historicalFixture?.fixture?.date || null,
        home_score: homeGoals != null ? String(homeGoals) : null,
        away_score: awayGoals != null ? String(awayGoals) : null,
        winner: determineWinnerLabel(historicalFixture),
        status_short: historicalFixture?.fixture?.status?.short || "NS",
        league_api_id:
          historicalFixture?.league?.id != null
            ? String(historicalFixture.league.id)
            : null,
        season: seasonLabel,
        created_at: now,
        updated_at: now,
      },
    );
    saved += 1;
  }

  return saved;
}

async function fetchAndSaveH2HForFixtures({
  tablesdb,
  databaseId,
  h2hTable,
  fixtures,
  h2hFetchLimit,
  prefetchedH2HMap,
  logger,
}) {
  const limit =
    Number.isFinite(h2hFetchLimit) && h2hFetchLimit > 0
      ? h2hFetchLimit
      : fixtures.length;
  const log = typeof logger === "function" ? logger : console.log;
  const h2hCache =
    prefetchedH2HMap instanceof Map ? prefetchedH2HMap : new Map();
  let totalSaved = 0;

  log(
    JSON.stringify({
      job: "daily-sync-generate",
      stage: "h2h-batch-start",
      total_fixtures: fixtures.length,
      fetch_limit: limit,
    }),
  );

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    if (fixtureIndex >= limit) {
      log(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixture.api_fixture_id || null,
          stage: "h2h-skipped",
          reason: "h2h-fetch-limit-reached",
        }),
      );
      continue;
    }

    try {
      const prefetched =
        h2hCache.get(String(fixture.api_fixture_id || "")) || null;
      const saved = await saveFixtureH2HHistory({
        tablesdb,
        databaseId,
        h2hTable,
        fixture,
        prefetchedH2HFixtures: prefetched,
        logger: log,
      });

      totalSaved += saved;
      log(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixture.api_fixture_id || null,
          stage: "h2h",
          h2h_rows_saved: saved,
        }),
      );
    } catch (error) {
      log(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixture.api_fixture_id || null,
          stage: "h2h",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  log(
    JSON.stringify({
      job: "daily-sync-generate",
      stage: "h2h-batch-complete",
      h2h_fixtures_processed: Math.min(fixtures.length, limit),
      h2h_rows_saved: totalSaved,
    }),
  );

  return { totalSaved, h2hFetchedFixtures: Math.min(fixtures.length, limit) };
}

async function fetchRows(tablesdb, databaseId, tableId, queries) {
  const result = await tablesdb.listRows({
    databaseId,
    tableId,
    queries,
    total: false,
  });
  return result.rows || [];
}

async function fetchAllRows(
  tablesdb,
  databaseId,
  tableId,
  baseQueries,
  pageSize = 100,
) {
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

    if (pageRows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

function buildRowIndex(rows, keySelector) {
  const index = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keySelector(row);
    if (!key) {
      continue;
    }

    const normalizedKey = String(key);
    const existing = index.get(normalizedKey);
    if (existing) {
      existing.push(row);
    } else {
      index.set(normalizedKey, [row]);
    }
  }

  return index;
}

function mergeFixtureContexts(fixtures, h2hRows) {
  const h2hIndex = buildRowIndex(h2hRows, (row) => row.current_fixture_api_id);

  return Array.isArray(fixtures)
    ? fixtures.map((fixture) => {
        const fixtureApiId = fixture.api_fixture_id || null;
        return {
          fixture,
          fixtureApiId,
          h2hRows: fixtureApiId ? h2hIndex.get(String(fixtureApiId)) || [] : [],
        };
      })
    : [];
}

function toDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default async function main(context) {
  const { res, error: reportError } = context;
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const { log: appwriteLog, error: appwriteError } =
    buildAppwriteLogger(context);

  const databaseId = required("APPWRITE_DATABASE_ID");
  const teamsTable = required("APPWRITE_TABLE_TEAMS");
  const leaguesTable = required("APPWRITE_TABLE_LEAGUES");
  const fixturesTable = required("APPWRITE_TABLE_FIXTURES");
  const h2hTable = required("APPWRITE_TABLE_FIXTURE_H2H_HISTORY");
  const predictionsTable = required("APPWRITE_TABLE_PREDICTIONS");
  const syncRunsTable = required("APPWRITE_TABLE_SYNC_RUNS");

  const league = process.env.API_FOOTBALL_LEAGUE
    ? Number(process.env.API_FOOTBALL_LEAGUE)
    : null;
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate(0);
  const syncRunId = `sync_${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}`;
  const startedAt = isoNow();

  const url = new URL(
    `${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}/fixtures`,
  );
  url.searchParams.set("date", fetchDate);
  if (league) {
    url.searchParams.set("league", String(league));
  }

  let syncCompleted = false;

  try {
    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "fixtures-request",
        request_url: url.toString(),
      }),
    );

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
    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "fixtures-fetched",
        date: fetchDate,
        total_fixtures: fixtures.length,
      }),
    );

    if (fixtures.length === 0) {
      const predictionsCleanup = await deletePredictionRowsOutsideWindow(
        tablesdb,
        databaseId,
        predictionsTable,
        appwriteLog,
      );

      await createRun(tablesdb, databaseId, syncRunsTable, {
        job_name: "cleanup-raw-fetch",
        sync_run_id: syncRunId,
        status: "success",
        started_at: startedAt,
        finished_at: isoNow(),
        items_seen: "0",
        items_saved: "0",
        message: `API-Football returned no fixtures for ${fetchDate}. Predictions were pruned to yesterday, today, and tomorrow.`,
        created_at: isoNow(),
        updated_at: isoNow(),
      });

      appwriteLog(
        JSON.stringify({
          job: "daily-sync-generate",
          stage: "run-empty",
          date: fetchDate,
          request_url: url.toString(),
          reason: "api-football-returned-no-fixtures",
        }),
      );

      return res.json({
        ok: true,
        cleaned: {
          teams: null,
          leagues: null,
          fixtures: null,
          h2h: null,
          predictions: predictionsCleanup?.deleted ?? null,
        },
        items_seen: "0",
        items_saved: "0",
        items_failed: "0",
        published: "0",
        notified: "0",
        h2h_fixtures_processed: "0",
        h2h_rows_saved: "0",
        predictions_deleted: String(predictionsCleanup?.deleted ?? 0),
        sync_run_id: syncRunId,
      });
    }

    const maxFixtures = Number.parseInt(process.env.MAX_FIXTURES || "300", 10);
    const minSelectionTarget = 200;
    const minPerHour = Math.max(
      1,
      Number.parseInt(process.env.MIN_FIXTURES_PER_HOUR || "1", 10) || 1,
    );

    // ─── STEP 1: Pre-filter ───────────────────────────────────────────────────
    // Drop finished / cancelled / postponed matches immediately — no API calls.
    const FINISHED_STATUSES = new Set([
      "FT",
      "AET",
      "PEN",
      "ABD",
      "AWD",
      "WO",
      "CANC",
      "PST",
      "SUSP",
      "INT",
    ]);

    const upcomingFixtures = fixtures.filter((f) => {
      const id = f?.fixture?.id ?? null;
      const home = f?.teams?.home?.id ?? null;
      const away = f?.teams?.away?.id ?? null;
      const status = f?.fixture?.status?.short ?? "NS";
      return (
        id != null &&
        home != null &&
        away != null &&
        !FINISHED_STATUSES.has(status)
      );
    });

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "step-1-pre-filter",
        total_from_api: fixtures.length,
        upcoming: upcomingFixtures.length,
        skipped_finished: fixtures.length - upcomingFixtures.length,
      }),
    );

    // ─── STEP 2: Group by Lagos hour ──────────────────────────────────────────
    // Group ALL upcoming fixtures by kickoff hour BEFORE scoring.
    // This guarantees every hour is visible and gets scored independently.
    const byHourMap = new Map(); // hour -> fixture[]
    for (const f of upcomingFixtures) {
      const kickoff = parseFixtureKickoff(f?.fixture?.date || null);
      if (!kickoff) continue;
      const hour = getTimeZoneHour(kickoff, "Africa/Lagos");
      if (!byHourMap.has(hour)) byHourMap.set(hour, []);
      byHourMap.get(hour).push(f);
    }

    const allHours = [...byHourMap.keys()].sort((a, b) => a - b);
    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "step-2-grouped-by-hour",
        hours: allHours,
        per_hour: Object.fromEntries(
          allHours.map((h) => [h, byHourMap.get(h).length]),
        ),
      }),
    );

    // ─── STEP 3: Score each hour in parallel ─────────────────────────────────
    // Each hour runs concurrently. Within each hour fixtures are scored in
    // batches of 10 to keep API calls manageable.
    // Popular-league fixtures (POPULAR_LEAGUE_IDS) always get a +30 bonus.
    async function scoreOneFixtureSafe(f) {
      const fixtureId = String(f?.fixture?.id ?? "");
      const leagueId = f?.league?.id ?? null;
      const leagueName = f?.league?.name || "";
      const countryMatch = isCountryMatch(f);
      let oddsRows = [];
      let h2hFixtures = [];

      try {
        const oddsPayload = await fetchApiFootballJson("/odds", {
          fixture: fixtureId,
        });
        for (const entry of Array.isArray(oddsPayload?.response)
          ? oddsPayload.response
          : []) {
          for (const bk of Array.isArray(entry?.bookmakers)
            ? entry.bookmakers
            : []) {
            for (const bet of Array.isArray(bk?.bets) ? bk.bets : []) {
              for (const val of Array.isArray(bet?.values) ? bet.values : []) {
                if (val?.value != null) {
                  oddsRows.push({
                    market_name: bet?.name,
                    selection_name: String(val.value),
                  });
                }
              }
            }
          }
        }
      } catch (_) {
        oddsRows = [];
      }

      try {
        h2hFixtures = await fetchCachedH2HRowsForPair(
          tablesdb,
          databaseId,
          h2hTable,
          fixtureId,
          f?.teams?.home?.id ?? null,
          f?.teams?.away?.id ?? null,
        );
      } catch (_) {
        h2hFixtures = [];
      }

      const priorityBucket =
        countryMatch ||
        isWorldCupCompetitionName(leagueName) ||
        popularityBonus(leagueId, leagueName) > 0
          ? 0
          : h2hFixtures.length > 0
            ? 1
            : 2;

      const { score, reasons } = scoreFixture({
        oddsRows,
        h2hRows: h2hFixtures,
        leagueId,
        leagueName,
        isCountry: countryMatch,
      });

      return {
        fixture: f,
        score,
        reasons,
        oddsRows,
        h2hFixtures,
        priorityBucket,
      };
    }

    async function scoreHour(hourFixtures) {
      const BATCH = 10;
      const results = [];
      for (let i = 0; i < hourFixtures.length; i += BATCH) {
        const batch = hourFixtures.slice(i, i + BATCH);
        const batchResults = await Promise.all(
          batch.map(async (fixture) => {
            const result = await scoreOneFixtureSafe(fixture);
            return (
              result ?? {
                fixture,
                score: 0,
                reasons: ['scoring-fallback'],
                oddsRows: [],
                h2hFixtures: [],
              }
            );
          }),
        );
        for (const r of batchResults) {
          if (r != null) {
            results.push(r);
          }
        }
      }
      return results;
    }

    // All hours scored simultaneously — no hour waits for another
    const scoredByHour = new Map(); // hour -> scored[]
    const hourScoringResults = await Promise.all(
      allHours.map(async (hour) => ({
        hour,
        results: await scoreHour(byHourMap.get(hour)),
      })),
    );
    for (const { hour, results } of hourScoringResults) {
      // Sort each hour's pool best-score-first
      results.sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        const popularityDiff =
          popularityBonus(
            b.fixture?.league?.id,
            b.fixture?.league?.name,
          ) -
          popularityBonus(
            a.fixture?.league?.id,
            a.fixture?.league?.name,
          );
        if (popularityDiff !== 0) {
          return popularityDiff;
        }

        return String(a.fixture?.fixture?.id ?? "").localeCompare(
          String(b.fixture?.fixture?.id ?? ""),
        );
      });
      scoredByHour.set(hour, results);
    }

    const totalScored = [...scoredByHour.values()].reduce(
      (s, arr) => s + arr.length,
      0,
    );
    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "step-3-scored",
        total_upcoming: upcomingFixtures.length,
        total_scored: totalScored,
        scored_per_hour: Object.fromEntries(
          allHours.map((h) => [h, scoredByHour.get(h)?.length ?? 0]),
        ),
      }),
    );

    // ─── STEP 4: Select with hour spread ──────────────────────────────────────
    // Rule A: always include ALL popular-league fixtures first (no cap).
    // Rule B: fill remaining slots by round-robin across hours,
    //         picking minPerHour fixtures per hour per round before cycling.
    //         No hour is skipped — every hour completes its slice before
    //         any hour gets another slice.

    const usedIds = new Set();
    const selected = []; // { fixture, score, h2hFixtures, kickoff, hour }

    const selectItem = (item, hour) => {
      const id = String(item.fixture?.fixture?.id ?? "");
      if (!id || usedIds.has(id)) {
        return false;
      }

      const kickoff = parseFixtureKickoff(item.fixture?.fixture?.date || null);
      usedIds.add(id);
      selected.push({ ...item, kickoff, hour });
      return true;
    };

    const comparePriority = (a, b) => {
      const bucketDiff = (a.priorityBucket ?? 2) - (b.priorityBucket ?? 2);
      if (bucketDiff !== 0) {
        return bucketDiff;
      }

      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const popularityDiff =
        popularityBonus(b.fixture?.league?.id, b.fixture?.league?.name) -
        popularityBonus(a.fixture?.league?.id, a.fixture?.league?.name);
      if (popularityDiff !== 0) {
        return popularityDiff;
      }

      return String(a.fixture?.fixture?.id ?? "").localeCompare(
        String(b.fixture?.fixture?.id ?? ""),
      );
    };

    const selectBucket = (bucketValue) => {
      for (const hour of allHours) {
        const bucketItems = (scoredByHour.get(hour) ?? [])
          .filter((item) => {
            const id = String(item.fixture?.fixture?.id ?? "");
            return (
              id &&
              !usedIds.has(id) &&
              (item.priorityBucket ?? 2) === bucketValue
            );
          })
          .sort(comparePriority);

        for (const item of bucketItems) {
          if (selected.length >= maxFixtures) {
            return;
          }
          selectItem(item, hour);
        }
      }
    };

    // Priority order:
    // 1) world cup / country / popular
    // 2) fixtures with H2H
    // 3) fixtures without H2H
    selectBucket(0);
    selectBucket(1);
    selectBucket(2);

    if (selected.length < minSelectionTarget) {
      const topUpCandidates = [];
      for (const hour of allHours) {
        for (const item of scoredByHour.get(hour) ?? []) {
          const id = String(item.fixture?.fixture?.id ?? "");
          if (!id || usedIds.has(id)) {
            continue;
          }
          topUpCandidates.push({ ...item, hour });
        }
      }

      topUpCandidates.sort(comparePriority);

      for (const item of topUpCandidates) {
        if (selected.length >= Math.min(maxFixtures, minSelectionTarget)) {
          break;
        }
        selectItem(item, item.hour);
      }
    }

    const selectionTargetReached =
      selected.length >= Math.min(minSelectionTarget, upcomingFixtures.length);
    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "step-4-selection-verify",
        target_min_selected: minSelectionTarget,
        total_available: upcomingFixtures.length,
        selected_after_fill: selected.length,
        target_reached: selectionTargetReached,
      }),
    );

    // Sort final list by kickoff time ascending
    selected.sort(
      (a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0),
    );

    const hourCounts = {};
    for (const item of selected)
      hourCounts[item.hour] = (hourCounts[item.hour] || 0) + 1;
    const popularCount = selected.filter(
      (s) =>
        popularityBonus(s.fixture?.league?.id, s.fixture?.league?.name) > 0,
    ).length;
    const worldCupCount = selected.filter(
      (s) =>
        isWorldCupCompetitionName(s.fixture?.league?.name) ||
        Number(s.fixture?.league?.id) === WORLD_CUP_LEAGUE_ID,
    ).length;

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "step-4-selected",
        popular_included: popularCount,
        world_cup_included: worldCupCount,
        total_selected: selected.length,
        target_min_selected: minSelectionTarget,
        max_cap: maxFixtures,
        min_per_hour: minPerHour,
        hours_represented: Object.keys(hourCounts).length,
        hour_counts: hourCounts,
      }),
    );

    const selectedFixtures = selected.map((s) => s.fixture);
    const prefetchedH2HMap = new Map(
      selected.map((s) => [
        String(s.fixture?.fixture?.id ?? ""),
        s.h2hFixtures,
      ]),
    );

    const [fixturesDelete, predictionsCleanup] = await Promise.all([
      deleteAllRows(tablesdb, databaseId, fixturesTable),
      deletePredictionRowsOutsideWindow(
        tablesdb,
        databaseId,
        predictionsTable,
        appwriteLog,
      ),
    ]);

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: "cleanup-raw-fetch",
      sync_run_id: syncRunId,
      status: "success",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: "0",
      items_saved: "0",
      message: `Deleted existing fixtures before the next sync cycle and pruned predictions outside ${predictionsCleanup.keptDates.join(", ")}. Preserved teams, leagues, and h2h history.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    for (const fixture of selectedFixtures) {
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;
      const fixtureApiId =
        fixture?.fixture?.id != null ? String(fixture.fixture.id) : null;

      appwriteLog(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixtureApiId,
          stage: "processing",
        }),
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

      appwriteLog(
        JSON.stringify({
          job: "daily-sync-generate",
          fixture_api_id: fixtureApiId,
          stage: "saved-fixture",
        }),
      );
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: "sync-fixtures",
      sync_run_id: syncRunId,
      status: "success",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(selectedFixtures.length),
      items_saved: String(selectedFixtures.length),
      message: `Synced ${selectedFixtures.length} selected fixtures from API-Football (from ${fixtures.length} fetched).`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    syncCompleted = true;

    const syncedFixtures = await fetchAllRows(
      tablesdb,
      databaseId,
      fixturesTable,
      [Query.equal("sync_run_id", syncRunId), Query.orderAsc("$createdAt")],
    );

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "fixtures-loaded",
        total_fixtures: syncedFixtures.length,
      }),
    );

    const h2hFetchLimit = Number.parseInt(
      process.env.H2H_FETCH_FIXTURE_LIMIT ||
        String(Math.max(1, syncedFixtures.length)),
      10,
    );
    const h2hFetchResult = await fetchAndSaveH2HForFixtures({
      tablesdb,
      databaseId,
      h2hTable,
      fixtures: syncedFixtures,
      h2hFetchLimit,
      prefetchedH2HMap,
      logger: appwriteLog,
    });
    const syncedH2hRows = await fetchAllRows(
      tablesdb,
      databaseId,
      h2hTable,
      [],
    );

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "h2h-loaded",
        h2h_rows: syncedH2hRows.length,
        h2h_fixtures_processed: h2hFetchResult.h2hFetchedFixtures,
      }),
    );

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "merged-contexts-ready",
        total_contexts: syncedFixtures.length,
      }),
    );

    appwriteLog(
      JSON.stringify({
        job: "daily-sync-generate",
        stage: "run-complete",
        sync_run_id: syncRunId,
        fixtures_total: fixtures.length,
        contexts_total: syncedFixtures.length,
        predictions_saved: 0,
        predictions_failed: 0,
        predictions_skipped: 0,
        predictions_published: 0,
        predictions_notified: 0,
        h2h_fixtures_processed: h2hFetchResult.h2hFetchedFixtures,
        h2h_rows_saved: h2hFetchResult.totalSaved,
      }),
    );

    return res.json({
      ok: true,
      cleaned: {
        fixtures: fixturesDelete?.total ?? null,
        predictions: predictionsCleanup?.deleted ?? null,
        teams: 0,
        leagues: 0,
        h2h: 0,
      },
      items_seen: String(syncedFixtures.length),
      items_saved: String(syncedFixtures.length),
      items_failed: "0",
      items_skipped: "0",
      published: "0",
      notified: "0",
      h2h_fixtures_processed: String(h2hFetchResult.h2hFetchedFixtures),
      h2h_rows_saved: String(h2hFetchResult.totalSaved),
      predictions_deleted: String(predictionsCleanup?.deleted ?? 0),
      sync_run_id: syncRunId,
    });
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: syncCompleted ? "sync-fixtures" : "cleanup-raw-fetch",
      sync_run_id: syncRunId,
      status: "failed",
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: "0",
      items_saved: "0",
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    appwriteError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
