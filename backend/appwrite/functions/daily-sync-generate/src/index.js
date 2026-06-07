import { Client, TablesDB, ID, Query } from 'node-appwrite';

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

function buildAppwriteLogger(context) {
  const log = typeof context?.log === 'function'
    ? (message) => context.log(message)
    : (message) => console.log(message);
  const error = typeof context?.error === 'function'
    ? (message) => context.error(message)
    : (message) => console.error(message);

  return { log, error };
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

function lagosDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const base = new Date(Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
  ));
  base.setUTCDate(base.getUTCDate() + offsetDays);

  const year = base.getUTCFullYear();
  const month = String(base.getUTCMonth() + 1).padStart(2, '0');
  const day = String(base.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseFixtureKickoff(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTimeZoneHour(value, timeZone = 'Africa/Lagos') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(value);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number.parseInt(map.hour, 10);
}

function compareSelectedFixtureItems(left, right) {
  const leftKickoff = left.kickoff || new Date(0);
  const rightKickoff = right.kickoff || new Date(0);
  const comparison = leftKickoff.getTime() - rightKickoff.getTime();
  if (comparison !== 0) {
    return comparison;
  }

  return String(left.fixture?.fixture?.id ?? '').localeCompare(String(right.fixture?.fixture?.id ?? ''));
}

function selectFixturesBySession(fixtures, amLimit, pmLimit, timeZone = 'Africa/Lagos') {
  const decorated = (Array.isArray(fixtures) ? fixtures : [])
    .map((fixture, index) => {
      const kickoff = parseFixtureKickoff(fixture?.fixture?.date || null);
      if (!kickoff) {
        return null;
      }

      const localHour = getTimeZoneHour(kickoff, timeZone);
      return {
        fixture,
        kickoff,
        localHour,
        bucket: localHour < 12 ? 'am' : 'pm',
        index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const comparison = left.kickoff.getTime() - right.kickoff.getTime();
      if (comparison !== 0) {
        return comparison;
      }
      return left.index - right.index;
    });

  const bucketSelect = (bucket, limit) => {
    const bucketItems = decorated.filter((item) => item.bucket === bucket);
    const chosen = [];
    const chosenIndexes = new Set();
    const seenHours = new Set();

    for (const item of bucketItems) {
      if (chosen.length >= limit) {
        break;
      }

      if (seenHours.has(item.localHour)) {
        continue;
      }

      seenHours.add(item.localHour);
      chosen.push(item);
      chosenIndexes.add(item.index);
    }

    for (const item of bucketItems) {
      if (chosen.length >= limit) {
        break;
      }

      if (chosenIndexes.has(item.index)) {
        continue;
      }

      chosen.push(item);
      chosenIndexes.add(item.index);
    }

    return chosen.sort(compareSelectedFixtureItems);
  };

  const amSelected = bucketSelect('am', amLimit);
  const pmSelected = bucketSelect('pm', pmLimit);
  const selected = [...amSelected, ...pmSelected].sort(compareSelectedFixtureItems);

  return {
    selectedFixtures: selected.map((item) => item.fixture),
    stats: {
      totalAvailable: decorated.length,
      amAvailable: decorated.filter((item) => item.bucket === 'am').length,
      pmAvailable: decorated.filter((item) => item.bucket === 'pm').length,
      amSelected: amSelected.length,
      pmSelected: pmSelected.length,
      totalSelected: selected.length,
    },
  };
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

async function saveFixtureH2HHistory({
  tablesdb,
  databaseId,
  h2hTable,
  fixture,
  logger,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  const homeTeamId = String(fixture.home_team_api_id || '').trim();
  const awayTeamId = String(fixture.away_team_api_id || '').trim();
  const leagueId = String(fixture.league_api_id || '').trim();
  const season = String(fixture.season || '').trim();
  const log = typeof logger === 'function' ? logger : console.log;

  if (!fixtureApiId || !homeTeamId || !awayTeamId) {
    return 0;
  }

  const requestQuery = {
    h2h: `${homeTeamId}-${awayTeamId}`,
    last: 5,
  };
  if (leagueId) {
    requestQuery.league = leagueId;
  }
  if (season && String(process.env.API_FOOTBALL_H2H_INCLUDE_SEASON || '').toLowerCase() === 'true') {
    requestQuery.season = season;
  }

  const requestUrl = buildApiFootballUrl('/fixtures/headtohead', requestQuery).toString();

  log(
    JSON.stringify({
      job: 'daily-sync-generate',
      fixture_api_id: fixtureApiId,
      stage: 'h2h-request',
      request_url: requestUrl,
    }),
  );

  const payload = await fetchApiFootballJson('/fixtures/headtohead', requestQuery);

  const historicalFixtures = Array.isArray(payload?.response) ? payload.response : [];
  log(
    JSON.stringify({
      job: 'daily-sync-generate',
      fixture_api_id: fixtureApiId,
      stage: 'h2h-response',
      historical_matches: historicalFixtures.length,
      api_get: payload?.get || null,
      api_results: payload?.results ?? null,
      api_errors: payload?.errors || [],
    }),
  );

  let saved = 0;
  const now = isoNow();

  for (const historicalFixture of historicalFixtures) {
    const historicalFixtureApiId = historicalFixture?.fixture?.id ?? null;
    if (historicalFixtureApiId == null) {
      continue;
    }

    const historicalFixtureId = String(historicalFixtureApiId);
    const homeGoals = historicalFixture?.goals?.home;
    const awayGoals = historicalFixture?.goals?.away;

    await upsertRow(
      tablesdb,
      databaseId,
      h2hTable,
      `h2h_${safeIdPart(fixtureApiId)}_${safeIdPart(historicalFixtureId)}`,
      {
        current_fixture_api_id: fixtureApiId,
        // The table enforces historical_fixture_api_id as unique, so we use a
        // unique cache key here to avoid collisions across different current fixtures.
        historical_fixture_api_id: `${fixtureApiId}_${historicalFixtureId}`,
        home_team_api_id: String(historicalFixture?.teams?.home?.id ?? homeTeamId),
        away_team_api_id: String(historicalFixture?.teams?.away?.id ?? awayTeamId),
        kickoff_at: historicalFixture?.fixture?.date || null,
        home_score: homeGoals != null ? String(homeGoals) : null,
        away_score: awayGoals != null ? String(awayGoals) : null,
        winner: determineWinnerLabel(historicalFixture),
        status_short: historicalFixture?.fixture?.status?.short || 'NS',
        league_api_id: historicalFixture?.league?.id != null ? String(historicalFixture.league.id) : null,
        season: historicalFixture?.league?.season != null ? String(historicalFixture.league.season) : null,
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
  logger,
}) {
  const limit = Number.isFinite(h2hFetchLimit) && h2hFetchLimit > 0
    ? h2hFetchLimit
    : fixtures.length;
  const log = typeof logger === 'function' ? logger : console.log;

  let totalSaved = 0;

  log(
    JSON.stringify({
      job: 'daily-sync-generate',
      stage: 'h2h-batch-start',
      total_fixtures: fixtures.length,
      fetch_limit: limit,
    }),
  );

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    if (fixtureIndex >= limit) {
      log(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixture.api_fixture_id || null,
          stage: 'h2h-skipped',
          reason: 'h2h-fetch-limit-reached',
        }),
      );
      continue;
    }

      try {
      const saved = await saveFixtureH2HHistory({
        tablesdb,
        databaseId,
        h2hTable,
        fixture,
        logger: log,
      });

      totalSaved += saved;

      log(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixture.api_fixture_id || null,
          stage: 'h2h',
          h2h_rows_saved: saved,
        }),
      );
    } catch (error) {
      log(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixture.api_fixture_id || null,
          stage: 'h2h',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  log(
    JSON.stringify({
      job: 'daily-sync-generate',
      stage: 'h2h-batch-complete',
      h2h_fixtures_processed: Math.min(fixtures.length, limit),
      h2h_rows_saved: totalSaved,
    }),
  );

  return { totalSaved, h2hFetchedFixtures: Math.min(fixtures.length, limit) };
}

async function fetchStoredH2HRowsForFixture(tablesdb, databaseId, h2hTable, fixtureApiId) {
  return fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal('current_fixture_api_id', String(fixtureApiId)),
    Query.orderAsc('$createdAt'),
  ]);
}

function buildPrompt(fixture, h2hRows) {
  return [
    'You are a football prediction assistant.',
    'Use the fixture and h2h history to produce a single JSON object.',
    'Return valid JSON only.',
    'Required JSON keys: predicted_winner, confidence, confidence_label, picks.',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include: selection, confidence, reason.',
    'The reason must be short, one sentence only, and should not include extra explanation.',
    'Prefer conservative non-straight-win markets such as Over/Under goals, Both Teams To Score, Double Chance, Draw, or No Bet.',
    "Don't generate straight-win selections like Home Win, Away Win, Team X to win, or bare team-name wins unless confidence is 0.99 or higher.",
    "Don't choose a straight-win pick unless you are extremely certain.",
    "Don't waste the response on straight-win markets when a conservative market is available.",
    'If the supplied H2H history is empty, use any fallback H2H history provided by the backend context.',
    'If no H2H history is available at all, do not invent it; use fixture context only and stay conservative.',
    'Focus on fixture context and h2h history when choosing the best conservative pick.',
    'Always provide one best conservative pick with a clear reason.',
    'Confidence should be a decimal between 0 and 1.',
    'Use confidence_label values like high, medium, or low.',
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
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

function isStraightWinSelection(selection) {
  const value = String(selection || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return (
    /\bhome\s+win\b/.test(value) ||
    /\baway\s+win\b/.test(value) ||
    /\bto\s+win\b/.test(value) ||
    /\bstraight\s+win\b/.test(value) ||
    /\b1x2\b/.test(value) ||
    /^\s*(home|away|draw)\s*$/.test(value) ||
    /\bwin\b/.test(value) && !/\bdouble\s+chance\b/.test(value)
  );
}

function isAllowedNonWinSelection(selection) {
  const value = String(selection || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return (
    /\bover\s*\d/.test(value) ||
    /\bunder\s*\d/.test(value) ||
    /\bboth\s+teams\s+to\s+score\b/.test(value) ||
    /\bbtts\b/.test(value) ||
    /\bdouble\s+chance\b/.test(value) ||
    /^\s*draw\s*$/.test(value) ||
    /\bno\s+bet\b/.test(value) ||
    /\basian\s+handicap\b/.test(value)
  );
}

function sanitizePrimarySelection(selection, confidence, fallbackSelection) {
  const trimmed = typeof selection === 'string' ? selection.trim() : '';
  const numericConfidence = typeof confidence === 'number' ? confidence : 0;
  const fallback = typeof fallbackSelection === 'string' && fallbackSelection.trim()
    ? fallbackSelection.trim()
    : 'Under 4.5 Goals';

  if (!trimmed) {
    return fallback;
  }

  if (isAllowedNonWinSelection(trimmed)) {
    return trimmed;
  }

  if (isStraightWinSelection(trimmed) && numericConfidence >= 0.99) {
    return trimmed;
  }

  return fallback;
}

function normalizeConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.8;
  }

  const decimalValue = value > 1 ? value / 100 : value;
  return Math.max(0.8, Math.min(0.999, decimalValue));
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

function stripCodeFences(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return '';
  }

  const fenceMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return value;
}

function extractFirstJsonBlock(text) {
  const value = stripCodeFences(text);
  if (!value) {
    return '';
  }

  const firstBrace = value.indexOf('{');
  const lastBrace = value.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1);
  }

  const firstBracket = value.indexOf('[');
  const lastBracket = value.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return value.slice(firstBracket, lastBracket + 1);
  }

  return value;
}

function parsePredictionJson(text) {
  const candidate = extractFirstJsonBlock(text);
  if (!candidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePredictionShape(parsed) {
  const safe = parsed && typeof parsed === 'object' ? parsed : {};
  const picks = Array.isArray(safe.picks) ? safe.picks : [];

  return {
    predicted_winner: typeof safe.predicted_winner === 'string' ? safe.predicted_winner : null,
    confidence: typeof safe.confidence === 'number' ? safe.confidence : null,
    confidence_label: typeof safe.confidence_label === 'string' ? safe.confidence_label : null,
    picks: picks.map((pick) => ({
      selection: typeof pick?.selection === 'string' ? pick.selection : null,
      confidence: typeof pick?.confidence === 'number' ? pick.confidence : null,
      reason: typeof pick?.reason === 'string' ? pick.reason : null,
    })),
  };
}

async function requestAiPrediction(fixtureApiId, prompt, fixture, logFn) {
  const systemPrompt = [
    'Return only valid JSON.',
    'Include predicted_winner, confidence, confidence_label, and picks.',
    'picks must be an array with exactly 1 item.',
    'The single pick must include selection, confidence, and reason.',
    'Do not add markdown, explanation text, or code fences.',
    'Do not add extra explanation outside the single short reason field.',
    'Use fixture context and h2h only.',
    'If H2H data is empty, rely on any fallback H2H data already supplied by the backend.',
    'If no H2H data exists at all, do not invent H2H and stay conservative.',
    'Prefer non-straight-win selections such as Over/Under, Both Teams To Score, Double Chance, Draw, or No Bet.',
    "Don't use straight-win selections unless confidence is 0.99 or higher.",
    "Don't waste credits on straight-win picks when a safer market is available.",
  ].join(' ');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  if (typeof logFn === 'function') {
    logFn(
      JSON.stringify({
        job: 'daily-sync-generate',
        fixture_api_id: fixtureApiId,
        stage: 'ai-request',
        message: 'Sending prediction request to DeepSeek.',
      }),
    );
  }

  let aiResponse = await deepSeekChat(messages);
  let content = aiResponse?.choices?.[0]?.message?.content || '';
  let parsed = parsePredictionJson(content);

  if (!parsed) {
    if (typeof logFn === 'function') {
      logFn(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          stage: 'ai-repair',
          message: 'Initial AI response was not clean JSON. Sending repair prompt.',
        }),
      );
    }

    const repairResponse = await deepSeekChat([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          prompt,
          '',
          'Your previous answer was not valid JSON.',
          'Return the exact same prediction content again, but only as valid JSON.',
          `FIXTURE_ID: ${fixtureApiId}`,
          `FIXTURE_SNAPSHOT: ${JSON.stringify(fixture)}`,
        ].join('\n'),
      },
    ]);

    aiResponse = repairResponse;
    content = aiResponse?.choices?.[0]?.message?.content || '';
    parsed = parsePredictionJson(content);
  }

  if (typeof logFn === 'function') {
    logFn(
      JSON.stringify({
        job: 'daily-sync-generate',
        fixture_api_id: fixtureApiId,
        stage: 'ai-complete',
        parsed_ok: Boolean(parsed),
      }),
    );
  }

  return {
    aiResponse,
    rawContent: content,
    parsed: normalizePredictionShape(parsed),
    parsedOk: Boolean(parsed),
  };
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
          h2hRows: fixtureApiId ? (h2hIndex.get(String(fixtureApiId)) || []) : [],
        };
      })
    : [];
}

function toDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePrimaryReason(reason, fixture, h2hRows, selection) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text && !/not enough data|insufficient|low data|no history/i.test(text)) {
    return text;
  }

  const home = fixture?.home_team_name || 'home team';
  const away = fixture?.away_team_name || 'away team';
  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  return `${selection || 'This pick'} is the best available choice for ${home} vs ${away} based on the fixture context${h2hCount ? ` and ${h2hCount} recent head-to-head matches` : ''}.`;
}

function buildFallbackPrimaryPick(fixture, h2hRows) {
  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  const totalGoals = Array.isArray(h2hRows)
    ? h2hRows.reduce((sum, row) => {
        const home = Number(row?.home_score);
        const away = Number(row?.away_score);
        if (!Number.isFinite(home) || !Number.isFinite(away)) {
          return sum;
        }
        return sum + home + away;
      }, 0)
    : 0;
  const averageGoals = h2hCount > 0 ? totalGoals / h2hCount : 0;
  const selection = averageGoals >= 2 ? 'Over 1.5 Goals' : 'Under 4.5 Goals';

  return {
    selection,
    confidence: 0.8,
    reason: normalizePrimaryReason(
      '',
      fixture,
      h2hRows,
      selection,
    ),
  };
}

async function savePredictionAndMaybePublish({
  tablesdb,
  databaseId,
  fixturesTable,
  predictionsTable,
  fixture,
  h2hRows,
  aiResponse,
  parsed,
  startedAt,
  logFn,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  const primaryPick = pickAt(parsed.picks, 0);
  const fallbackPick = buildFallbackPrimaryPick(fixture, h2hRows);
  const rawPrimaryConfidence = typeof primaryPick?.confidence === 'number'
    ? primaryPick.confidence
    : fallbackPick.confidence;
  const primarySelection = sanitizePrimarySelection(
    primaryPick?.selection,
    rawPrimaryConfidence,
    fallbackPick.selection,
  );
  const usedFallbackSelection = primarySelection === fallbackPick.selection
    && String(primaryPick?.selection || '').trim() !== fallbackPick.selection;
  const primaryConfidenceSource = usedFallbackSelection
    ? fallbackPick.confidence
    : rawPrimaryConfidence;
  const primaryReason = normalizePrimaryReason(
    isAllowedNonWinSelection(primarySelection) || (isStraightWinSelection(primarySelection) && rawPrimaryConfidence >= 0.99)
      ? primaryPick?.reason
      : fallbackPick.reason,
    fixture,
    h2hRows,
    primarySelection,
  );
  const primaryConfidence = normalizeConfidence(primaryConfidenceSource);
  const predictedWinner = parsed.predicted_winner || null;

  if (!fixtureApiId) {
    return { saved: false, published: false, notified: false };
  }

  await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
    fixture_api_id: fixtureApiId,
    model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    prediction_text: primaryReason,
    predicted_winner: predictedWinner,
    confidence: primaryConfidence,
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
    primary_confidence: primaryConfidence,
    primary_reason: primaryReason,
    secondary_market: null,
    secondary_selection: null,
    secondary_confidence: null,
    secondary_reason: null,
    tertiary_market: null,
    tertiary_selection: null,
    tertiary_confidence: null,
    tertiary_reason: null,
    release_status: 'published',
    release_at: startedAt,
    generated_at: startedAt,
    published_at: startedAt,
    notification_sent: false,
    notification_sent_at: null,
    created_at: startedAt,
    updated_at: isoNow(),
  });

  if (fixturesTable) {
    await upsertRow(tablesdb, databaseId, fixturesTable, `fixture_${fixtureApiId}`, {
      processed: true,
      processed_at: isoNow(),
      updated_at: isoNow(),
    });
  }

  if (typeof logFn === 'function') {
    logFn(
      JSON.stringify({
        job: 'daily-sync-generate',
        fixture_api_id: fixtureApiId,
        stage: 'prediction-saved',
        primary_market: primarySelection,
        primary_confidence: primaryConfidence,
      }),
    );
  }

  return { saved: true, published: true, notified: false };
}

async function generatePredictionsForBatch({
  tablesdb,
  databaseId,
  fixtureContexts,
  fixturesTable,
  h2hTable,
  predictionsTable,
  startedAt,
  logFn,
}) {
  let saved = 0;
  let failed = 0;
  let published = 0;
  let notified = 0;
  const concurrency = parseConcurrency(process.env.APPWRITE_PREDICTION_CONCURRENCY || 10);
  const logger = typeof logFn === 'function' ? logFn : console.log;

  logger(
    JSON.stringify({
      job: 'daily-sync-generate',
      stage: 'prediction-batch-start',
      total_fixtures: fixtureContexts.length,
      concurrency,
    }),
  );

  await runWithConcurrency(fixtureContexts, concurrency, async (contextRow) => {
    try {
      const fixture = contextRow?.fixture || null;
      const fixtureApiId = contextRow?.fixtureApiId || fixture?.api_fixture_id || null;
      if (!fixtureApiId) {
        failed += 1;
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            message: 'Skipping fixture with missing api_fixture_id',
            fixture_snapshot: fixture,
          }),
        );
        return;
      }

      const h2hRows = Array.isArray(contextRow?.h2hRows) ? contextRow.h2hRows : [];
      logger(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          stage: 'prediction-start',
          h2h_rows: h2hRows.length,
        }),
      );

      let workingH2hRows = h2hRows;
      if (workingH2hRows.length === 0 && String(process.env.API_FOOTBALL_ON_DEMAND_H2H || 'true').toLowerCase() !== 'false') {
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            stage: 'h2h-on-demand-start',
            message: 'No cached H2H rows found; fetching them for this fixture.',
          }),
        );

        try {
          await saveFixtureH2HHistory({
            tablesdb,
            databaseId,
            h2hTable,
            fixture,
            logger,
          });

          workingH2hRows = await fetchStoredH2HRowsForFixture(tablesdb, databaseId, h2hTable, fixtureApiId);

          logger(
            JSON.stringify({
              job: 'daily-sync-generate',
              fixture_api_id: fixtureApiId,
              stage: 'h2h-on-demand-complete',
              h2h_rows: workingH2hRows.length,
            }),
          );
        } catch (error) {
          logger(
            JSON.stringify({
              job: 'daily-sync-generate',
              fixture_api_id: fixtureApiId,
              stage: 'h2h-on-demand-failed',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }

      const prompt = buildPrompt(fixture, workingH2hRows);
      let aiResult;
      try {
        aiResult = await requestAiPrediction(fixtureApiId, prompt, fixture, logger);
      } catch (error) {
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            stage: 'ai',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        aiResult = {
          aiResponse: null,
          rawContent: '',
          parsed: normalizePredictionShape(null),
          parsedOk: false,
        };
      }

      if (!aiResult.parsedOk) {
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            stage: 'ai',
            message: 'AI returned content that could not be parsed cleanly; using fallback normalization.',
          }),
        );
      }

      const result = await savePredictionAndMaybePublish({
        tablesdb,
        databaseId,
        fixturesTable,
        predictionsTable,
        fixture,
        h2hRows: workingH2hRows,
        aiResponse: aiResult.aiResponse,
        parsed: aiResult.parsed,
        startedAt,
        logFn,
      });

      if (!result.saved) {
        failed += 1;
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            message: 'Prediction save failed for this fixture.',
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
      logger(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: contextRow?.fixtureApiId || contextRow?.fixture?.api_fixture_id || null,
          stage: 'prediction-worker',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  logger(
    JSON.stringify({
      job: 'daily-sync-generate',
      stage: 'prediction-batch-complete',
      saved,
      failed,
      published,
      notified,
    }),
  );

  return { saved, failed, published, notified };
}

export default async function main(context) {
  const { res, error: reportError } = context;
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const { log: appwriteLog, error: appwriteError } = buildAppwriteLogger(context);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const teamsTable = required('APPWRITE_TABLE_TEAMS');
  const leaguesTable = required('APPWRITE_TABLE_LEAGUES');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');

  const league = process.env.API_FOOTBALL_LEAGUE ? Number(process.env.API_FOOTBALL_LEAGUE) : null;
  const fetchDate = process.env.API_FOOTBALL_DATE || lagosDate(0);
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
    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'fixtures-request',
        request_url: url.toString(),
      }),
    );

    const response = await fetch(url.toString(), {
      headers: buildApiFootballHeaders(),
    });

    if (!response.ok) {
      throw new Error(`API-Football request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];
    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'fixtures-fetched',
        date: fetchDate,
        total_fixtures: fixtures.length,
      }),
    );

    if (fixtures.length === 0) {
      await createRun(tablesdb, databaseId, syncRunsTable, {
        job_name: 'sync-fixtures',
        sync_run_id: syncRunId,
        status: 'success',
        started_at: startedAt,
        finished_at: isoNow(),
        items_seen: '0',
        items_saved: '0',
        message: `API-Football returned no fixtures for ${fetchDate}. Raw tables were not cleared.`,
        created_at: isoNow(),
        updated_at: isoNow(),
      });

      appwriteLog(
        JSON.stringify({
          job: 'daily-sync-generate',
          stage: 'run-empty',
          date: fetchDate,
          request_url: url.toString(),
          reason: 'api-football-returned-no-fixtures',
        }),
      );

      return res.json({
        ok: true,
        cleaned: {
          teams: null,
          leagues: null,
          fixtures: null,
          h2h: null,
        },
        items_seen: '0',
        items_saved: '0',
        items_failed: '0',
        published: '0',
        notified: '0',
        h2h_fixtures_processed: '0',
        h2h_rows_saved: '0',
        sync_run_id: syncRunId,
      });
    }

    const amLimit = Number.parseInt(process.env.API_FOOTBALL_MAX_AM_FIXTURES || '50', 10);
    const pmLimit = Number.parseInt(process.env.API_FOOTBALL_MAX_PM_FIXTURES || '50', 10);
    const selectedFixturesResult = selectFixturesBySession(fixtures, amLimit, pmLimit, 'Africa/Lagos');
    const selectedFixtures = selectedFixturesResult.selectedFixtures;

    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'fixtures-selected',
        total_available: selectedFixturesResult.stats.totalAvailable,
        am_available: selectedFixturesResult.stats.amAvailable,
        pm_available: selectedFixturesResult.stats.pmAvailable,
        am_selected: selectedFixturesResult.stats.amSelected,
        pm_selected: selectedFixturesResult.stats.pmSelected,
        total_selected: selectedFixturesResult.stats.totalSelected,
      }),
    );

    const [teamsDelete, leaguesDelete, fixturesDelete, h2hDelete] = await Promise.all([
      deleteAllRows(tablesdb, databaseId, teamsTable),
      deleteAllRows(tablesdb, databaseId, leaguesTable),
      deleteAllRows(tablesdb, databaseId, fixturesTable),
      deleteAllRows(tablesdb, databaseId, h2hTable),
    ]);

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'cleanup-raw-fetch',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: '0',
      items_saved: '0',
      message: 'Deleted existing teams, leagues, fixtures, and h2h rows before the next sync cycle.',
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    for (const fixture of selectedFixtures) {
      const leagueInfo = fixture.league;
      const homeTeam = fixture.teams.home;
      const awayTeam = fixture.teams.away;
      const fixtureApiId = fixture?.fixture?.id != null ? String(fixture.fixture.id) : null;

      appwriteLog(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          stage: 'processing',
        }),
      );

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

      appwriteLog(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          stage: 'saved-fixture',
        }),
      );
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'sync-fixtures',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(selectedFixtures.length),
      items_saved: String(selectedFixtures.length),
      message: `Synced ${selectedFixtures.length} selected fixtures from API-Football (from ${fixtures.length} fetched).`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    syncCompleted = true;

    const syncedFixtures = await fetchAllRows(tablesdb, databaseId, fixturesTable, [
      Query.equal('sync_run_id', syncRunId),
      Query.orderAsc('$createdAt'),
    ]);

    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'fixtures-loaded',
        total_fixtures: syncedFixtures.length,
      }),
    );

    const h2hFetchLimit = Number.parseInt(
      process.env.H2H_FETCH_FIXTURE_LIMIT || String(Math.min(25, Math.max(1, syncedFixtures.length))),
      10,
    );
    const h2hFetchResult = await fetchAndSaveH2HForFixtures({
      tablesdb,
      databaseId,
      h2hTable,
      fixtures: syncedFixtures,
      h2hFetchLimit,
      logger: appwriteLog,
    });
    const syncedH2hRows = await fetchAllRows(tablesdb, databaseId, h2hTable, []);
    const fixtureContexts = mergeFixtureContexts(syncedFixtures, syncedH2hRows);

    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'h2h-loaded',
        h2h_rows: syncedH2hRows.length,
        h2h_fixtures_processed: h2hFetchResult.h2hFetchedFixtures,
      }),
    );

    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'merged-contexts-ready',
        total_contexts: fixtureContexts.length,
      }),
    );

    const generationResult = await generatePredictionsForBatch({
      tablesdb,
      databaseId,
      fixtureContexts,
      fixturesTable,
      h2hTable,
      predictionsTable,
      startedAt,
      logFn: appwriteLog,
    });
    generationCompleted = true;

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtureContexts.length),
      items_saved: String(generationResult.saved),
      message: `Generated ${generationResult.saved} predictions from merged batch ${syncRunId}. Published ${generationResult.published} immediately and notified ${generationResult.notified}.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    appwriteLog(
      JSON.stringify({
        job: 'daily-sync-generate',
        stage: 'run-complete',
        sync_run_id: syncRunId,
        fixtures_total: fixtures.length,
        contexts_total: fixtureContexts.length,
        predictions_saved: generationResult.saved,
        predictions_failed: generationResult.failed,
        predictions_published: generationResult.published,
        h2h_fixtures_processed: h2hFetchResult.h2hFetchedFixtures,
        h2h_rows_saved: h2hFetchResult.totalSaved,
      }),
    );

    return res.json({
      ok: true,
      cleaned: {
        teams: teamsDelete?.total ?? null,
        leagues: leaguesDelete?.total ?? null,
        fixtures: fixturesDelete?.total ?? null,
        h2h: h2hDelete?.total ?? null,
      },
      items_seen: String(fixtureContexts.length),
      items_saved: String(generationResult.saved),
      items_failed: String(generationResult.failed),
      published: String(generationResult.published),
      notified: String(generationResult.notified),
      h2h_fixtures_processed: String(h2hFetchResult.h2hFetchedFixtures),
      h2h_rows_saved: String(h2hFetchResult.totalSaved),
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

    appwriteError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
