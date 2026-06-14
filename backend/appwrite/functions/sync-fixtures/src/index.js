const { Client, TablesDB, ID } = require('node-appwrite');

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

function buildApiFootballUrl(path, query = {}) {
  const url = new URL(`${required('API_FOOTBALL_BASE_URL').replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') {
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

function safeIdPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

function isoNow() {
  return new Date().toISOString();
}

function lagosDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, '0');
  const day = String(base.getUTCDate()).padStart(2, '0');
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

function toTextNumber(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : String(value);
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function determineWinnerLabel(historicalFixture) {
  const homeWinner = historicalFixture?.teams?.home?.winner;
  const awayWinner = historicalFixture?.teams?.away?.winner;

  if (homeWinner === true) {
    return 'home';
  }

  if (awayWinner === true) {
    return 'away';
  }

  const homeGoals = historicalFixture?.goals?.home;
  const awayGoals = historicalFixture?.goals?.away;
  if (typeof homeGoals === 'number' && typeof awayGoals === 'number') {
    if (homeGoals > awayGoals) {
      return 'home';
    }
    if (awayGoals > homeGoals) {
      return 'away';
    }
    return 'draw';
  }

  return null;
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

function countOddsSignals(oddsRows) {
  const rows = Array.isArray(oddsRows) ? oddsRows : [];
  let signals = 0;

  for (const row of rows) {
    const market = String(row?.market_name || '').toLowerCase();
    const selection = String(row?.selection_name || '').toLowerCase();
    if (
      market.includes('over') ||
      market.includes('under') ||
      market.includes('btts') ||
      market.includes('both teams') ||
      market.includes('double chance') ||
      market.includes('corner') ||
      market.includes('throw') ||
      selection.includes('over') ||
      selection.includes('under') ||
      selection.includes('yes') ||
      selection.includes('no')
    ) {
      signals += 1;
    }
  }

  return signals;
}

function scoreFixtureForSync({ oddsRows, h2hRows }) {
  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  const oddsCount = Array.isArray(oddsRows) ? oddsRows.length : 0;
  const oddsSignals = countOddsSignals(oddsRows);

  if (h2hCount <= 0) {
    return { score: 0, qualified: false, reasons: ['missing-h2h'] };
  }

  let score = 0;
  const reasons = [];

  if (h2hCount >= 10) {
    score += 50;
    reasons.push('strong-h2h');
  } else if (h2hCount >= 5) {
    score += 40;
    reasons.push('good-h2h');
  } else {
    score += 25;
    reasons.push('light-h2h');
  }

  if (oddsCount > 0) {
    score += 20;
    reasons.push('odds-present');
    if (oddsSignals > 0) {
      score += Math.min(20, oddsSignals * 5);
      reasons.push('good-odds-signals');
    }
  } else {
    reasons.push('no-odds');
  }

  return {
    score,
    qualified: true,
    reasons,
  };
}

async function fetchFixtureH2HHistory({
  fixture,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  const homeTeamId = String(fixture.home_team_api_id || '').trim();
  const awayTeamId = String(fixture.away_team_api_id || '').trim();
  const leagueId = String(fixture.league_api_id || '').trim();
  const season = String(fixture.season || '').trim();

  if (!fixtureApiId || !homeTeamId || !awayTeamId) {
    return { saved: 0, rows: [] };
  }

  const requestQuery = {
    h2h: `${homeTeamId}-${awayTeamId}`,
  };
  if (leagueId) {
    requestQuery.league = leagueId;
  }
  if (season) {
    requestQuery.season = season;
  }
  requestQuery.last = '20';

  const payload = await fetchApiFootballJson('/fixtures/headtohead', requestQuery);
  const historicalFixtures = Array.isArray(payload?.response) ? payload.response : [];
  const now = isoNow();
  const rows = [];

  for (const historicalFixture of historicalFixtures) {
    const historicalFixtureApiId = historicalFixture?.fixture?.id ?? null;
    if (historicalFixtureApiId == null) {
      continue;
    }

    const historicalFixtureId = String(historicalFixtureApiId);
    rows.push({
      rowId: `h2h_${safeIdPart(fixtureApiId)}_${safeIdPart(historicalFixtureId)}`,
      data: {
        current_fixture_api_id: fixtureApiId,
        historical_fixture_api_id: `${fixtureApiId}_${historicalFixtureId}`,
        home_team_api_id: String(historicalFixture?.teams?.home?.id ?? homeTeamId),
        away_team_api_id: String(historicalFixture?.teams?.away?.id ?? awayTeamId),
        kickoff_at: historicalFixture?.fixture?.date || null,
        home_score: toTextNumber(historicalFixture?.goals?.home),
        away_score: toTextNumber(historicalFixture?.goals?.away),
        winner: determineWinnerLabel(historicalFixture),
        status_short: historicalFixture?.fixture?.status?.short || 'NS',
        league_api_id: historicalFixture?.league?.id != null ? String(historicalFixture.league.id) : null,
        season: historicalFixture?.league?.season != null ? String(historicalFixture.league.season) : null,
        created_at: now,
        updated_at: now,
      },
    });
  }

  return {
    saved: rows.length,
    rows: rows.map((row) => compactH2HRow(row.data)),
  };
}

async function fetchFixtureOdds({
  fixture,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  if (!fixtureApiId) {
    return { saved: 0, rows: [] };
  }

  const payload = await fetchApiFootballJson('/odds', {
    fixture: fixtureApiId,
  });

  const fixtures = Array.isArray(payload?.response) ? payload.response : [];
  const now = isoNow();
  const rows = [];

  for (const fixtureOdds of fixtures) {
    const bookmakers = Array.isArray(fixtureOdds?.bookmakers) ? fixtureOdds.bookmakers : [];
    for (const bookmaker of bookmakers) {
      const bets = Array.isArray(bookmaker?.bets) ? bookmaker.bets : [];
      for (const bet of bets) {
        const values = Array.isArray(bet?.values) ? bet.values : [];
        for (const value of values) {
          const selectionName = value?.value != null ? String(value.value) : null;
          if (!selectionName) {
            continue;
          }

          rows.push({
            rowId: `odds_${safeIdPart(fixtureApiId)}_${safeIdPart(bookmaker?.id ?? bookmaker?.name)}_${safeIdPart(bet?.name)}_${safeIdPart(selectionName)}`,
            data: {
              fixture_api_id: fixtureApiId,
              bookmaker_name: bookmaker?.name || null,
              bookmaker_api_id: bookmaker?.id != null ? String(bookmaker.id) : null,
              market_name: bet?.name || null,
              selection_name: selectionName,
              odd_value: toTextNumber(value?.odd),
              line_value: value?.handicap != null ? String(value.handicap) : (value?.value != null ? String(value.value) : null),
              last_update_at: bookmaker?.last_update || fixtureOdds?.update || null,
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

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({
    databaseId,
    tableId,
    rowId: ID.unique(),
    data,
  });
}

async function main() {
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
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate(1);

  const url = new URL(`${required('API_FOOTBALL_BASE_URL').replace(/\/$/, '')}/fixtures`);
  url.searchParams.set('date', fetchDate);
  if (league) {
    url.searchParams.set('league', String(league));
  }

  const startedAt = isoNow();
  const syncRunId = `sync_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  let itemsSaved = 0;
  let h2hPassedCount = 0;
  let scorePassedCount = 0;
  let h2hSkippedCount = 0;

  try {
    const response = await fetch(url.toString(), {
      headers: buildApiFootballHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API-Football request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];

    console.log(JSON.stringify({
      job: 'sync-fixtures',
      stage: 'fixtures-fetched',
      fetched: fixtures.length,
      date: fetchDate,
      league: league || null,
    }));

    const qualifiedFixtures = [];
    for (const fixture of fixtures) {
      const fixtureApiId = fixture?.fixture?.id ?? fixture?.id ?? null;
      const leagueInfo = fixture?.league || null;
      const homeTeam = fixture?.teams?.home || null;
      const awayTeam = fixture?.teams?.away || null;

      if (!fixtureApiId || !leagueInfo || !homeTeam || !awayTeam) {
        continue;
      }

      const fixtureStub = {
        api_fixture_id: String(fixtureApiId),
        league_api_id: String(leagueInfo.id),
        season: String(leagueInfo.season),
        home_team_api_id: String(homeTeam.id),
        away_team_api_id: String(awayTeam.id),
      };

      const [oddsResult, h2hResult] = await Promise.all([
        fetchFixtureOdds({
          fixture: fixtureStub,
        }),
        fetchFixtureH2HHistory({
          fixture: fixtureStub,
        }),
      ]);

      if ((h2hResult.saved ?? 0) === 0) {
        h2hSkippedCount += 1;
        console.log(JSON.stringify({
          job: 'sync-fixtures',
          fixture_api_id: fixtureApiId,
          stage: 'fixture-skip',
          reason: 'missing-h2h',
          message: 'Fixture not saved because no H2H data was available.',
        }));
        continue;
      }

      h2hPassedCount += 1;

      const syncScore = scoreFixtureForSync({
        oddsRows: oddsResult.rows || [],
        h2hRows: h2hResult.rows || [],
      });

      if (!syncScore.qualified) {
        continue;
      }

      scorePassedCount += 1;

      qualifiedFixtures.push({
        fixture,
        oddsRows: oddsResult.rows || [],
        h2hRows: h2hResult.rows || [],
        score: syncScore.score,
        reasons: syncScore.reasons,
      });
    }

    qualifiedFixtures.sort((left, right) => {
      const scoreDiff = (right.score || 0) - (left.score || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return String(left.fixture?.fixture?.id || '').localeCompare(String(right.fixture?.fixture?.id || ''));
    });

    const selectedFixtures = qualifiedFixtures.slice(0, 100);

    console.log(JSON.stringify({
      job: 'sync-fixtures',
      stage: 'fixtures-qualified',
      h2h_passed: h2hPassedCount,
      h2h_skipped: h2hSkippedCount,
      score_passed: scorePassedCount,
      top_100_selected: selectedFixtures.length,
    }));

    for (const qualified of selectedFixtures) {
      const fixture = qualified.fixture;
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;
      const fixtureApiId = String(fixture.fixture.id);
      const teamRows = [
        { tableId: teamsTable, rowId: `team_${homeTeam.id}`, data: pickTeam(homeTeam) },
        { tableId: teamsTable, rowId: `team_${awayTeam.id}`, data: pickTeam(awayTeam) },
      ];

      const leagueRow = {
        tableId: leaguesTable,
        rowId: `league_${leagueInfo.id}_${fixture.league.season}`,
        data: pickLeague(leagueInfo, fixture.league.season),
      };

      const mergedSummary = buildFixtureMergeSummary(qualified.oddsRows, qualified.h2hRows);
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
        rowId: `h2h_${safeIdPart(fixtureApiId)}_${safeIdPart(row.historical_fixture_api_id || `${row.kickoff_at || ''}_${row.home_score || ''}_${row.away_score || ''}_${row.winner || ''}`)}`,
        data: {
          current_fixture_api_id: fixtureApiId,
          historical_fixture_api_id: row.historical_fixture_api_id || `${fixtureApiId}_${safeIdPart(`${row.kickoff_at || ''}_${row.home_score || ''}_${row.away_score || ''}_${row.winner || ''}`)}`,
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

      for (const row of [...teamRows, leagueRow, fixtureRow, ...oddsRowsToSave, ...h2hRowsToSave]) {
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
      items_seen: selectedFixtures.length,
      items_saved: itemsSaved,
      message: `Fetched ${fixtures.length} fixtures. ${h2hPassedCount} passed H2H. ${h2hSkippedCount} were skipped without H2H. ${scorePassedCount} passed the score gate. Saved top ${itemsSaved} qualified fixtures.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return {
      ok: true,
      items_seen: selectedFixtures.length,
      items_saved: itemsSaved,
    };
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'sync-fixtures',
      sync_run_id: syncRunId,
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: itemsSaved,
      items_saved: itemsSaved,
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
