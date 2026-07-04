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

async function fetchRows(tablesdb, databaseId, tableId, queries) {
  const result = await tablesdb.listRows({
    databaseId,
    tableId,
    queries,
    total: false,
  });
  return result.rows || [];
}

function buildApiFootballHeaders() {
  return {
    "x-apisports-key": required("API_FOOTBALL_KEY"),
    "x-apisports-host":
      process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io",
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

  return response.json();
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

function toTextNumber(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isNaN(value) ? null : String(value);
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
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

async function fetchCachedH2HRowsForPair(
  tablesdb,
  databaseId,
  h2hTable,
  fixtureApiId,
  homeTeamId,
  awayTeamId,
) {
  const currentFixtureRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal("current_fixture_api_id", String(fixtureApiId)),
    Query.orderAsc("$createdAt"),
  ]);

  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);
  if (!pairKey) {
    return currentFixtureRows;
  }

  const pairRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal("pair_key", pairKey),
    Query.orderAsc("$createdAt"),
  ]);

  const rowsByHistoricalId = new Map();
  for (const row of [...currentFixtureRows, ...pairRows]) {
    const key = String(row?.historical_fixture_api_id || row?.$id || "").trim();
    if (!key || rowsByHistoricalId.has(key)) {
      continue;
    }
    rowsByHistoricalId.set(key, row);
  }

  return [...rowsByHistoricalId.values()];
}

function compactOddsRow(row) {
  return {
    fixture_api_id: row?.fixture_api_id || null,
    bookmaker_name: row?.bookmaker_name || null,
    bookmaker_api_id: row?.bookmaker_api_id || null,
    market_name: row?.market_name || null,
    selection_name: row?.selection_name || null,
    odd_value: row?.odd_value ?? null,
    line_value: row?.line_value || null,
    last_update_at: row?.last_update_at || null,
  };
}

function compactH2HRow(row) {
  return {
    current_fixture_api_id: row?.current_fixture_api_id || null,
    historical_fixture_api_id: row?.historical_fixture_api_id || null,
    kickoff_at: row?.kickoff_at || null,
    home_score: row?.home_score || null,
    away_score: row?.away_score || null,
    winner: row?.winner || null,
    status_short: row?.status_short || null,
    league_api_id: row?.league_api_id || null,
    season: row?.season || null,
  };
}

function normalizeH2HRow(row) {
  if (!row || typeof row !== "object") {
    return {};
  }

  return row.data && typeof row.data === "object" ? row.data : row;
}

function summarizeH2HFixtureLog({
  fixtureApiId,
  leagueName,
  homeTeamName,
  awayTeamName,
  h2hRowsFetched,
  h2hRowsSaved,
  apiEmptyResponse,
  h2hRows,
}) {
  return {
    job: "sync-fixtures",
    stage: "fixture.h2h.summary",
    fixture_api_id: fixtureApiId || null,
    league_name: leagueName || null,
    home_team_name: homeTeamName || null,
    away_team_name: awayTeamName || null,
    h2h_rows_fetched: Number(h2hRowsFetched) || 0,
    h2h_rows_saved: Number(h2hRowsSaved) || 0,
    api_empty_response: Boolean(apiEmptyResponse),
    h2h_scores: Array.isArray(h2hRows) ? h2hRows : [],
  };
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

// World Cup league ID
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

function countOddsSignals(oddsRows) {
  const rows = Array.isArray(oddsRows) ? oddsRows : [];
  let signals = 0;

  for (const row of rows) {
    const market = String(row?.market_name || "").toLowerCase();
    const selection = String(row?.selection_name || "").toLowerCase();
    if (
      market.includes("over") ||
      market.includes("under") ||
      market.includes("btts") ||
      market.includes("both teams") ||
      market.includes("double chance") ||
      market.includes("corner") ||
      market.includes("throw") ||
      selection.includes("over") ||
      selection.includes("under") ||
      selection.includes("yes") ||
      selection.includes("no")
    ) {
      signals += 1;
    }
  }

  return signals;
}

function scoreFixtureForSync({ oddsRows, h2hRows, leagueId, leagueName, isCountry }) {
  // No restrictions - all fixtures qualify
  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  const oddsCount = Array.isArray(oddsRows) ? oddsRows.length : 0;
  const isWorldCup =
    Number(leagueId) === WORLD_CUP_LEAGUE_ID ||
    isWorldCupCompetitionName(leagueName);

  let score = 50; // Base score for all fixtures
  const reasons = ["auto-qualified"];

  // Add bonus points but don't restrict
  if (isWorldCup) {
    score += 100;
    reasons.push("world-cup");
  }

  if (isCountry || isWorldCup) {
    score += 60;
    reasons.push("country-match");
  }

  if (h2hCount > 0) {
    score += h2hCount * 5; // More H2H = higher score
    reasons.push("has-h2h");
  }

  if (oddsCount > 0) {
    score += 20;
    reasons.push("has-odds");
  }

  return {
    score,
    qualified: true, // Always qualified
    reasons,
  };
}

async function fetchFixtureH2HHistory({
  fixture,
  tablesdb,
  databaseId,
  h2hTable,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || "").trim();
  const homeTeamId = String(fixture.home_team_api_id || "").trim();
  const awayTeamId = String(fixture.away_team_api_id || "").trim();
  const leagueId = String(fixture.league_api_id || "").trim();
  const season = String(fixture.season || "").trim();
  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);

  // Always return something, even if data is missing
  if (!fixtureApiId) {
    return { saved: 0, rows: [] };
  }

  // Continue even if team IDs are missing - use fallbacks
  const safeHomeTeamId = homeTeamId || "home_unknown";
  const safeAwayTeamId = awayTeamId || "away_unknown";

  const now = isoNow();
  const targetSeasons = getH2hSeasonRange(season);
  const cachedRows = await fetchCachedH2HRowsForPair(
    tablesdb,
    databaseId,
    h2hTable,
    fixtureApiId,
    homeTeamId,
    awayTeamId,
  );
  const existingSeasons = new Set(
    cachedRows.map((row) => String(row?.season || "").trim()).filter(Boolean),
  );
  const missingSeasons = targetSeasons.filter(
    (seasonYear) => !existingSeasons.has(String(seasonYear)),
  );
  const rows = [...cachedRows];
  let saved = 0;
  let apiEmptyResponse = false;
  const apiScores = [];

  if (missingSeasons.length === 0) {
    return {
      saved: rows.length,
      apiEmptyResponse: false,
      apiScores: rows.map((row) => compactH2HRow(normalizeH2HRow(row))),
      rows: rows.map((row) => compactH2HRow(normalizeH2HRow(row))),
    };
  }

  for (const seasonYear of missingSeasons) {
    const requestQuery = {
      h2h: `${homeTeamId}-${awayTeamId}`,
      season: String(seasonYear),
      last: "20",
    };
    if (leagueId) {
      requestQuery.league = leagueId;
    }

    const payload = await fetchApiFootballJson(
      "/fixtures/headtohead",
      requestQuery,
    );
    const historicalFixtures = Array.isArray(payload?.response)
      ? payload.response
      : [];

    if (historicalFixtures.length === 0) {
      apiEmptyResponse = true;
    }

    for (const historicalFixture of historicalFixtures) {
      const historicalFixtureApiId = historicalFixture?.fixture?.id ?? null;
      if (historicalFixtureApiId == null) {
        continue;
      }

      const historicalFixtureId = String(historicalFixtureApiId);
      const seasonLabel = String(
        historicalFixture?.league?.season ?? seasonYear,
      );
      const compositeHistoricalId = `${pairKey || fixtureApiId}_${seasonLabel}_${historicalFixtureId}`;
      const compactRow = compactH2HRow({
        current_fixture_api_id: fixtureApiId,
        historical_fixture_api_id: compositeHistoricalId,
        kickoff_at: historicalFixture?.fixture?.date || null,
        home_score: toTextNumber(historicalFixture?.goals?.home),
        away_score: toTextNumber(historicalFixture?.goals?.away),
        winner: determineWinnerLabel(historicalFixture),
        status_short: historicalFixture?.fixture?.status?.short || "NS",
        league_api_id:
          historicalFixture?.league?.id != null
            ? String(historicalFixture.league.id)
            : null,
        season: seasonLabel,
      });
      apiScores.push(compactRow);
      rows.push({
        rowId: `h2h_${safeIdPart(pairKey || fixtureApiId)}_${safeIdPart(seasonLabel)}_${safeIdPart(historicalFixtureId)}`,
        data: {
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
          home_score: toTextNumber(historicalFixture?.goals?.home),
          away_score: toTextNumber(historicalFixture?.goals?.away),
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
      });
      saved += 1;
    }
  }

  const newRows = rows.slice(cachedRows.length);
  for (const row of newRows) {
    await upsertRow(tablesdb, databaseId, h2hTable, row.rowId, row.data);
  }

  return {
    saved: rows.length,
    apiEmptyResponse,
    apiScores,
    rows: rows.map((row) => compactH2HRow(normalizeH2HRow(row))),
  };
}

async function fetchFixtureOdds({ fixture }) {
  const fixtureApiId = String(fixture.api_fixture_id || "").trim();

  // Always return something, even if no fixtureApiId
  if (!fixtureApiId) {
    return { saved: 0, rows: [] };
  }

  const payload = await fetchApiFootballJson("/odds", {
    fixture: fixtureApiId,
  });

  const fixtures = Array.isArray(payload?.response) ? payload.response : [];
  const now = isoNow();
  const rows = [];

  for (const fixtureOdds of fixtures) {
    const bookmakers = Array.isArray(fixtureOdds?.bookmakers)
      ? fixtureOdds.bookmakers
      : [];
    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker?.bets) ? bookmaker.bets : [];
      for (const bet of bets) {
        const values = Array.isArray(bet?.values) ? bet.values : [];
        for (const value of values) {
          const selectionName =
            value?.value != null ? String(value.value) : null;
          if (!selectionName) {
            continue;
          }

          rows.push({
            rowId: `odds_${safeIdPart(fixtureApiId)}_${safeIdPart(bookmaker?.id ?? bookmaker?.name)}_${safeIdPart(bet?.name)}_${safeIdPart(selectionName)}`,
            data: {
              fixture_api_id: fixtureApiId,
              bookmaker_name: bookmaker?.name || null,
              bookmaker_api_id:
                bookmaker?.id != null ? String(bookmaker.id) : null,
              market_name: bet?.name || null,
              selection_name: selectionName,
              odd_value: toTextNumber(value?.odd),
              line_value:
                value?.handicap != null
                  ? String(value.handicap)
                  : value?.value != null
                    ? String(value.value)
                    : null,
              last_update_at:
                bookmaker?.last_update || fixtureOdds?.update || null,
              created_at: now,
              updated_at: now,
            },
          });
        }
      }
    }
  }

  return {
    saved: rows.length,
    rows: rows.map((row) => compactOddsRow(row.data)),
  };
}

function buildFixtureMergeSummary(oddsRows, h2hRows) {
  return {
    odds_summary: JSON.stringify(oddsRows || []),
    h2h_summary: JSON.stringify(h2hRows || []),
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
  const oddsTable = required("APPWRITE_TABLE_FIXTURE_ODDS");
  const h2hTable = required("APPWRITE_TABLE_FIXTURE_H2H_HISTORY");
  const syncRunsTable = required("APPWRITE_TABLE_SYNC_RUNS");

  const league = process.env.API_FOOTBALL_LEAGUE
    ? Number(process.env.API_FOOTBALL_LEAGUE)
    : null;
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate(0);

  const url = new URL(
    `${required("API_FOOTBALL_BASE_URL").replace(/\/$/, "")}/fixtures`,
  );
  url.searchParams.set("date", fetchDate);
  if (league) {
    url.searchParams.set("league", String(league));
  }

  const startedAt = isoNow();
  const syncRunId = `sync_${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}`;
  let itemsSaved = 0;
  let h2hPassedCount = 0;
  let scorePassedCount = 0;
  let h2hSkippedCount = 0;
  const minimumH2hRows = Number.parseInt(process.env.H2H_MIN_ROWS || "2", 10);

  try {
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

    console.log(
      JSON.stringify({
        job: "sync-fixtures",
        stage: "fixtures-fetched",
        fetched: fixtures.length,
        date: fetchDate,
        league: league || null,
      }),
    );

    // Process ALL fixtures without any restrictions
    const allFixtures = [];

    for (const fixture of fixtures) {
      const fixtureApiId = fixture?.fixture?.id ?? fixture?.id ?? null;
      const leagueInfo = fixture?.league || null;
      const homeTeam = fixture?.teams?.home || null;
      const awayTeam = fixture?.teams?.away || null;

      // Only skip if absolutely essential data is missing
      if (!fixtureApiId) {
        console.log(
          JSON.stringify({
            job: "sync-fixtures",
            stage: "fixture-skip",
            reason: "missing-fixture-id",
            fixture: fixture,
          }),
        );
        continue;
      }

      // Use fallback values for missing data instead of skipping
      const safeLeagueInfo = leagueInfo || { id: "unknown", season: "2024" };
      const safeHomeTeam = homeTeam || {
        id: "home_unknown",
        name: "Home Team",
      };
      const safeAwayTeam = awayTeam || {
        id: "away_unknown",
        name: "Away Team",
      };

      const fixtureStub = {
        api_fixture_id: String(fixtureApiId),
        league_api_id: String(safeLeagueInfo.id),
        season: String(safeLeagueInfo.season),
        home_team_api_id: String(safeHomeTeam.id),
        away_team_api_id: String(safeAwayTeam.id),
      };

      const isWorldCup =
        Number(safeLeagueInfo.id) === WORLD_CUP_LEAGUE_ID ||
        isWorldCupCompetitionName(safeLeagueInfo.name);

      // Get hour for distribution
      const kickoffTime = fixture?.fixture?.date || null;
      const hour = kickoffTime ? new Date(kickoffTime).getUTCHours() : 0;

      const [oddsResult, h2hResult] = await Promise.all([
        fetchFixtureOdds({
          fixture: fixtureStub,
        }),
        fetchFixtureH2HHistory({
          fixture: fixtureStub,
          tablesdb,
          databaseId,
          h2hTable,
        }),
      ]);

      const h2hSaved = Number(h2hResult.saved ?? 0);
      const hasH2h = h2hSaved >= 1;

      console.log(
        JSON.stringify(
          summarizeH2HFixtureLog({
            fixtureApiId,
            leagueName: safeLeagueInfo.name,
            homeTeamName: safeHomeTeam.name,
            awayTeamName: safeAwayTeam.name,
            h2hRowsFetched: Array.isArray(h2hResult.rows) ? h2hResult.rows.length : 0,
            h2hRowsSaved: h2hSaved,
            apiEmptyResponse: Boolean(h2hResult.apiEmptyResponse),
            h2hRows: h2hResult.apiScores || h2hResult.rows || [],
          }),
        ),
      );

      // Score all fixtures (no filtering)
      const syncScore = scoreFixtureForSync({
        oddsRows: oddsResult.rows || [],
        h2hRows: h2hResult.rows || [],
        leagueId: safeLeagueInfo.id,
        leagueName: safeLeagueInfo.name,
        isCountry: Boolean(safeHomeTeam.national || safeAwayTeam.national),
      });

      const fixtureData = {
        fixture,
        oddsRows: oddsResult.rows || [],
        h2hRows: h2hResult.rows || [],
        score: syncScore.score || 0,
        reasons: syncScore.reasons || [],
        hour,
        hasH2h,
        isWorldCup,
      };

      allFixtures.push(fixtureData);
    }

    // Sort all fixtures by score (World Cup gets priority)
    allFixtures.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Take all available fetched fixtures without any caps or limits
    const finalSelectedFixtures = allFixtures;

    console.log(
      JSON.stringify({
        job: "sync-fixtures",
        stage: "fixtures-selected",
        total_fetched: fixtures.length,
        total_processed: allFixtures.length,
        world_cup_count: allFixtures.filter((f) => f.isWorldCup).length,
        with_h2h_count: allFixtures.filter((f) => f.hasH2h).length,
        final_selected: finalSelectedFixtures.length,
      }),
    );

    for (const qualified of finalSelectedFixtures) {
      const fixture = qualified.fixture;
      const leagueInfo = fixture.league || { id: "unknown", season: "2024" };
      const homeTeam = fixture.teams?.home || {
        id: "home_unknown",
        name: "Home Team",
      };
      const awayTeam = fixture.teams?.away || {
        id: "away_unknown",
        name: "Away Team",
      };
      const fixtureApiId = String(fixture.fixture.id);
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

      const mergedSummary = buildFixtureMergeSummary(
        qualified.oddsRows,
        qualified.h2hRows,
      );
      const fixtureRow = {
        tableId: fixturesTable,
        rowId: `fixture_${fixtureApiId}`,
        data: {
          ...pickFixture(fixture, leagueInfo, homeTeam, awayTeam),
          ...mergedSummary,
          sync_run_id: syncRunId,
          processed: true,
          processed_at: isoNow(),
          delete_after_at: null,
        },
      };

      const oddsRowsToSave = qualified.oddsRows.map((row) => ({
        tableId: oddsTable,
        rowId: `odds_${safeIdPart(fixtureApiId)}_${safeIdPart(row.bookmaker_api_id ?? row.bookmaker_name)}_${safeIdPart(row.market_name)}_${safeIdPart(row.selection_name)}`,
        data: {
          fixture_api_id: fixtureApiId,
          bookmaker_name: row.bookmaker_name,
          bookmaker_api_id: row.bookmaker_api_id,
          market_name: row.market_name,
          selection_name: row.selection_name,
          odd_value: row.odd_value,
          line_value: row.line_value,
          last_update_at: row.last_update_at,
          created_at: isoNow(),
          updated_at: isoNow(),
        },
      }));

      const h2hRowsToSave = qualified.h2hRows.map((row) => ({
        tableId: h2hTable,
        rowId: `h2h_${safeIdPart(fixtureApiId)}_${safeIdPart(row.historical_fixture_api_id || `${row.kickoff_at || ""}_${row.home_score || ""}_${row.away_score || ""}_${row.winner || ""}`)}`,
        data: {
          current_fixture_api_id: fixtureApiId,
          historical_fixture_api_id:
            row.historical_fixture_api_id ||
            `${fixtureApiId}_${safeIdPart(`${row.kickoff_at || ""}_${row.home_score || ""}_${row.away_score || ""}_${row.winner || ""}`)}`,
          home_team_api_id: String(homeTeam.id),
          away_team_api_id: String(awayTeam.id),
          kickoff_at: row.kickoff_at,
          home_score: row.home_score,
          away_score: row.away_score,
          winner: row.winner,
          status_short: row.status_short,
          league_api_id: row.league_api_id,
          season: row.season,
          created_at: isoNow(),
          updated_at: isoNow(),
        },
      }));

      for (const row of [
        ...teamRows,
        leagueRow,
        fixtureRow,
        ...oddsRowsToSave,
        ...h2hRowsToSave,
      ]) {
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
      items_seen: String(finalSelectedFixtures.length),
      items_saved: String(itemsSaved),
      message: `Fetched ${fixtures.length} fixtures. ${h2hPassedCount} passed H2H. ${h2hSkippedCount} were skipped without H2H. ${scorePassedCount} passed the score gate. Saved ${itemsSaved} qualified fixtures (min: 200, max: 300).`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    console.log(JSON.stringify({
      level: "info",
      job: "sync-fixtures",
      step: "function.complete",
      timestamp: isoNow(),
      total_fetched: fixtures.length,
      total_saved: itemsSaved,
    }));

    const result = {
      ok: true,
      items_seen: finalSelectedFixtures.length,
      items_saved: itemsSaved,
    };
    return res ? res.json(result) : result;
  } catch (error) {
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
}

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
