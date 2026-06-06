import { Client, TablesDB, ID, Query, Messaging } from 'node-appwrite';

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

function buildPrompt(fixture, oddsRows, h2hRows) {
  return [
    'You are a football prediction assistant.',
    'Use the fixture, odds, and h2h history to produce a single JSON object.',
    'Return valid JSON only.',
    'Required JSON keys: predicted_winner, confidence, confidence_label, picks.',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include: selection, confidence, reason.',
    'Focus on low-odds markets such as over, under, gg/btts, corners, double chance 12, and throw-ins if the data exists.',
    'If throw-in data is not available, skip it.',
    'Confidence should be a decimal between 0 and 1.',
    'Use confidence_label values like high, medium, or low.',
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
    `ODDS: ${JSON.stringify(oddsRows)}`,
    `H2H_HISTORY: ${JSON.stringify(h2hRows)}`,
    '',
    'JSON EXAMPLE:',
    '{',
    '  "predicted_winner": "Team A",',
    '  "confidence": 0.86,',
    '  "confidence_label": "high",',
    '  "picks": [',
    '    {',
    '      "selection": "Over 1.5",',
    '      "confidence": 0.91,',
    '      "reason": "Both teams create enough chances for at least two goals."',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

function pickAt(picks, index) {
  const pick = Array.isArray(picks) ? picks[index] : null;
  if (!pick || typeof pick !== 'object') {
    return null;
  }

  return {
    selection: typeof pick.selection === 'string' ? pick.selection : null,
    confidence: typeof pick.confidence === 'number' ? pick.confidence : null,
    reason: typeof pick.reason === 'string' ? pick.reason : null,
  };
}

function normalizeConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.8;
  }

  const decimalValue = value > 1 ? value / 100 : value;
  return Math.max(0.8, Math.min(0.99, decimalValue));
}

function parseConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 10);
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await handler(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function deepSeekChat(messages) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${required('DEEPSEEK_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages,
      response_format: {
        type: 'json_object',
      },
      temperature: 0.2,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed with status ${response.status}`);
  }

  return response.json();
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

    if (pageRows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

function toDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinFourHours(kickoffAt, now) {
  if (!kickoffAt) {
    return false;
  }

  return kickoffAt.getTime() <= now.getTime() + 4 * 60 * 60 * 1000;
}

async function savePredictionAndMaybePublish({
  tablesdb,
  databaseId,
  predictionsTable,
  messaging,
  topicId,
  fixture,
  aiResponse,
  parsed,
  startedAt,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  const primaryPick = pickAt(parsed.picks, 0);
  const primaryReason = primaryPick?.reason?.trim() || '';
  const primarySelection = primaryPick?.selection?.trim() || '';

  if (!fixtureApiId || !primarySelection || !primaryReason) {
    return { saved: false, published: false, notified: false };
  }

  const kickoffAt = toDate(fixture.kickoff_at);
  const now = new Date();
  const releaseAt = kickoffAt
    ? new Date(kickoffAt.getTime() - 4 * 60 * 60 * 1000).toISOString()
    : null;
  const publishNow = kickoffAt ? isWithinFourHours(kickoffAt, now) : false;
  const publishedAt = publishNow ? isoNow() : null;

  await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
    fixture_api_id: fixtureApiId,
    model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    prediction_text: primaryReason,
    predicted_winner: parsed.predicted_winner || null,
    confidence: normalizeConfidence(parsed.confidence),
    confidence_label: parsed.confidence_label || null,
    home_team_name: fixture.home_team_name || null,
    away_team_name: fixture.away_team_name || null,
    home_team_logo_url: fixture.home_team_logo_url || null,
    away_team_logo_url: fixture.away_team_logo_url || null,
    kickoff_at: fixture.kickoff_at || null,
    match_status_short: fixture.status_short || null,
    match_status_long: fixture.status_long || null,
    primary_market: primarySelection,
    primary_selection: primarySelection,
    primary_confidence: normalizeConfidence(primaryPick?.confidence),
    primary_reason: primaryReason,
    secondary_market: null,
    secondary_selection: null,
    secondary_confidence: null,
    secondary_reason: null,
    tertiary_market: null,
    tertiary_selection: null,
    tertiary_confidence: null,
    tertiary_reason: null,
    release_status: publishNow ? 'published' : 'draft',
    release_at: releaseAt,
    generated_at: startedAt,
    published_at: publishedAt,
    notification_sent: false,
    notification_sent_at: null,
    created_at: startedAt,
    updated_at: isoNow(),
  });

  if (!publishNow) {
    return { saved: true, published: false, notified: false };
  }

  try {
    await messaging.createPush({
      messageId: ID.unique(),
      title: 'New prediction is live',
      body: primaryReason,
      topics: [topicId],
      data: {
        fixture_api_id: fixtureApiId,
        prediction_id: `prediction_${fixtureApiId}`,
        release_status: 'published',
      },
      draft: false,
    });

    await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
      release_status: 'published',
      published_at: publishedAt || isoNow(),
      notification_sent: true,
      notification_sent_at: isoNow(),
      updated_at: isoNow(),
    });

    return { saved: true, published: true, notified: true };
  } catch (error) {
    console.error(
      JSON.stringify({
        job: 'daily-sync-generate',
        fixture_api_id: fixtureApiId,
        stage: 'notification',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return { saved: true, published: true, notified: false };
  }
}

async function generatePredictionsForBatch({
  tablesdb,
  databaseId,
  fixtures,
  oddsTable,
  h2hTable,
  predictionsTable,
  messaging,
  topicId,
  startedAt,
}) {
  let saved = 0;
  let failed = 0;
  let published = 0;
  let notified = 0;
  const concurrency = parseConcurrency(process.env.APPWRITE_PREDICTION_CONCURRENCY || 1);

  await runWithConcurrency(fixtures, concurrency, async (fixture) => {
    try {
      const fixtureApiId = fixture.api_fixture_id || null;
      if (!fixtureApiId) {
        failed += 1;
        console.error(
          JSON.stringify({
            job: 'daily-sync-generate',
            message: 'Skipping fixture with missing api_fixture_id',
            fixture_snapshot: fixture,
          }),
        );
        return;
      }

      const oddsRows = await fetchRows(tablesdb, databaseId, oddsTable, [
        Query.equal('fixture_api_id', fixtureApiId),
        Query.orderAsc('$createdAt'),
      ]);

      const h2hRows = await fetchRows(tablesdb, databaseId, h2hTable, [
        Query.equal('current_fixture_api_id', fixtureApiId),
        Query.orderAsc('$createdAt'),
      ]);

      const prompt = buildPrompt(fixture, oddsRows, h2hRows);
      const aiResponse = await deepSeekChat([
        {
          role: 'system',
          content: 'Return only valid JSON. Include predicted_winner, confidence, confidence_label, and picks.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ]);

      const content = aiResponse?.choices?.[0]?.message?.content || '{}';
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {
          predicted_winner: null,
          confidence: null,
          confidence_label: null,
          picks: [],
        };
      }

      const result = await savePredictionAndMaybePublish({
        tablesdb,
        databaseId,
        predictionsTable,
        messaging,
        topicId,
        fixture,
        aiResponse,
        parsed,
        startedAt,
      });

      if (!result.saved) {
        failed += 1;
        console.error(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            message: 'Skipping prediction without a usable primary pick.',
          }),
        );
        return;
      }

      saved += 1;
      if (result.published) {
        published += 1;
      }
      if (result.notified) {
        notified += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixture.api_fixture_id || null,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  return { saved, failed, published, notified };
}

export default async function main({ res, error: reportError }) {
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const messaging = new Messaging(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const teamsTable = required('APPWRITE_TABLE_TEAMS');
  const leaguesTable = required('APPWRITE_TABLE_LEAGUES');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

  const league = process.env.API_FOOTBALL_LEAGUE ? Number(process.env.API_FOOTBALL_LEAGUE) : null;
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate();
  const syncRunId = `sync_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const startedAt = isoNow();

  const url = new URL(`${required('API_FOOTBALL_BASE_URL').replace(/\/$/, '')}/fixtures`);
  url.searchParams.set('date', fetchDate);
  if (league) {
    url.searchParams.set('league', String(league));
  }

  let syncCompleted = false;
  let generationCompleted = false;

  try {
    const [teamsDelete, leaguesDelete, fixturesDelete] = await Promise.all([
      deleteAllRows(tablesdb, databaseId, teamsTable),
      deleteAllRows(tablesdb, databaseId, leaguesTable),
      deleteAllRows(tablesdb, databaseId, fixturesTable),
    ]);

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'cleanup-raw-fetch',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: '0',
      items_saved: '0',
      message: 'Deleted existing teams, leagues, and fixtures before the next sync cycle.',
      created_at: isoNow(),
      updated_at: isoNow(),
    });
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
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'sync-fixtures',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(fixtures.length),
      message: `Synced ${fixtures.length} fixtures from API-Football.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    syncCompleted = true;

    const syncedFixtures = await fetchRows(tablesdb, databaseId, fixturesTable, [
      Query.equal('sync_run_id', syncRunId),
      Query.orderAsc('$createdAt'),
    ]);

    const generationResult = await generatePredictionsForBatch({
      tablesdb,
      databaseId,
      fixtures: syncedFixtures,
      oddsTable,
      h2hTable,
      predictionsTable,
      messaging,
      topicId,
      startedAt,
    });
    generationCompleted = true;

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(syncedFixtures.length),
      items_saved: String(generationResult.saved),
      message: `Generated ${generationResult.saved} predictions from batch ${syncRunId}. Published ${generationResult.published} immediately and notified ${generationResult.notified}.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return res.json({
      ok: true,
      cleaned: {
        teams: teamsDelete?.total ?? null,
        leagues: leaguesDelete?.total ?? null,
        fixtures: fixturesDelete?.total ?? null,
      },
      items_seen: String(fixtures.length),
      items_saved: String(generationResult.saved),
      items_failed: String(generationResult.failed),
      published: String(generationResult.published),
      notified: String(generationResult.notified),
      sync_run_id: syncRunId,
    });
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: generationCompleted ? 'generate-predictions' : syncCompleted ? 'sync-fixtures' : 'cleanup-raw-fetch',
      sync_run_id: syncRunId,
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: '0',
      items_saved: '0',
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    reportError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
