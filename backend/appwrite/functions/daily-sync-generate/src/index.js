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

function buildAppwriteLogger(context) {
  const log = typeof context?.log === 'function'
    ? (message) => context.log(message)
    : (message) => console.log(message);
  const error = typeof context?.error === 'function'
    ? (message) => context.error(message)
    : (message) => console.error(message);

  return { log, error };
}

const NOTIFICATION_CALL_TO_ACTIONS = [
  'Open the app now and check this one.',
  'Tap in and see the latest high-confidence pick.',
  'Check it now before kickoff starts.',
  'Jump in now and review the new prediction.',
  'Open the app and take a quick look.',
  'See the pick now while it is fresh.',
  'Tap to view this strong betting angle.',
  'Check the app now for the full breakdown.',
  'Open now and get the latest insight.',
  'See why this one stands out right now.',
  'Tap now and review the new market.',
  'Jump to the app and catch this pick early.',
  'Open the app and lock in the update.',
  'Take a look now before the line moves.',
  'Check this one out right now.',
  'Open now and view the fresh prediction.',
  'Tap in now and spot the edge.',
  'Go to the app now and review the call.',
  'See the latest read now.',
  'Open the app and study this pick now.',
  'Tap now and grab the update.',
  'Check it immediately and stay ahead.',
  'Open now and don’t miss this signal.',
  'Tap to see what just landed.',
  'Jump in now and review the model’s read.',
  'Open the app now for the latest call.',
  'Take a quick look now before it goes live.',
  'Check this prediction now and stay ready.',
  'Open now and see the new opportunity.',
  'Tap in and inspect this one now.',
  'See the update now and act fast.',
  'Open the app now and review the angle.',
  'Check now and keep ahead of kickoff.',
  'Tap to see the fresh pick now.',
  'Open now and view the latest edge.',
  'Take a look and move quickly.',
  'Check the latest prediction now.',
  'Open the app and see the live call.',
  'Tap in now and don’t miss the update.',
  'See the new pick now and stay sharp.',
  'Open now and review the strong signal.',
  'Check it out now while it is hot.',
  'Tap now and see the next move.',
  'Open the app and inspect this read.',
  'Jump in and see the latest value now.',
  'Take a look now and stay ahead.',
  'Open now and catch the fresh angle.',
  'Tap to review the latest call.',
  'See the pick now and keep moving.',
  'Open the app now and follow the signal.',
];

const HIGH_CONFIDENCE_REASON_THRESHOLD = 0.85;

function shouldSendPredictionNotification(confidence) {
  return Number.isFinite(confidence) && confidence >= 0.85;
}

function selectNotificationCTA(seedValue) {
  const seed = String(seedValue || '0');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return NOTIFICATION_CALL_TO_ACTIONS[hash % NOTIFICATION_CALL_TO_ACTIONS.length];
}

function buildNotificationCopy({ fixtureName, market, confidence, seedValue }) {
  const cta = selectNotificationCTA(seedValue);
  const marketName = String(market || 'prediction').trim();
  const confidenceLabel = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : 'high';
  const title = `High-confidence pick: ${marketName}`;
  const body = `${cta} ${fixtureName ? `${fixtureName}: ` : ''}${marketName} is live with ${confidenceLabel} confidence.`;

  return { title, body };
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

function buildTeamPairKey(homeTeamId, awayTeamId) {
  const home = String(homeTeamId || '').trim();
  const away = String(awayTeamId || '').trim();
  if (!home || !away) {
    return null;
  }

  return [home, away].sort().join('-');
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getH2hSeasonRange(fixtureSeason) {
  const historyYears = parsePositiveInteger(process.env.H2H_HISTORY_YEARS || '7', 7);
  const currentSeason = Number.parseInt(String(fixtureSeason || '').trim(), 10);
  const anchorYear = Number.isFinite(currentSeason) ? currentSeason : new Date().getFullYear();
  const startYear = Math.max(1900, anchorYear - historyYears + 1);
  const seasons = [];

  for (let seasonYear = startYear; seasonYear <= anchorYear; seasonYear += 1) {
    seasons.push(seasonYear);
  }

  return seasons;
}

async function fetchH2hRowsForPair(tablesdb, databaseId, h2hTable, fixtureApiId, homeTeamId, awayTeamId) {
  const fixtureRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal('current_fixture_api_id', String(fixtureApiId)),
    Query.orderAsc('$createdAt'),
  ]);

  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);
  if (!pairKey) {
    return fixtureRows;
  }

  const pairRows = await fetchRows(tablesdb, databaseId, h2hTable, [
    Query.equal('pair_key', pairKey),
    Query.orderAsc('$createdAt'),
  ]);

  const byHistoricalId = new Map();
  for (const row of [...fixtureRows, ...pairRows]) {
    const key = String(row?.historical_fixture_api_id || row?.$id || '').trim();
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
  logger,
}) {
  const fixtureApiId = String(fixture.api_fixture_id || '').trim();
  const homeTeamId = String(fixture.home_team_api_id || '').trim();
  const awayTeamId = String(fixture.away_team_api_id || '').trim();
  const leagueId = String(fixture.league_api_id || '').trim();
  const season = String(fixture.season || '').trim();
  const log = typeof logger === 'function' ? logger : console.log;
  const pairKey = buildTeamPairKey(homeTeamId, awayTeamId);

  if (!fixtureApiId || !homeTeamId || !awayTeamId) {
    return 0;
  }

  const targetSeasons = getH2hSeasonRange(season);
  const existingRows = await fetchH2hRowsForPair(tablesdb, databaseId, h2hTable, fixtureApiId, homeTeamId, awayTeamId);
  const existingSeasons = new Set(
    existingRows
      .map((row) => String(row?.season || '').trim())
      .filter(Boolean),
  );
  const missingSeasons = targetSeasons.filter((seasonYear) => !existingSeasons.has(String(seasonYear)));

  const now = isoNow();
  let saved = 0;

  if (missingSeasons.length === 0) {
    log(
      JSON.stringify({
        job: 'daily-sync-generate',
        fixture_api_id: fixtureApiId,
        stage: 'h2h-cached',
        pair_key: pairKey,
        seasons: targetSeasons,
        message: 'H2H history already cached for the requested season range.',
      }),
    );
    return 0;
  }

  for (const seasonYear of missingSeasons) {
    const requestQuery = {
      h2h: `${homeTeamId}-${awayTeamId}`,
      season: String(seasonYear),
      last: '20',
    };
    if (leagueId) {
      requestQuery.league = leagueId;
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
        season: seasonYear,
        historical_matches: historicalFixtures.length,
        api_get: payload?.get || null,
        api_results: payload?.results ?? null,
        api_errors: payload?.errors || [],
      }),
    );

    for (const historicalFixture of historicalFixtures) {
      const historicalFixtureApiId = historicalFixture?.fixture?.id ?? null;
      if (historicalFixtureApiId == null) {
        continue;
      }

      const historicalFixtureId = String(historicalFixtureApiId);
      const homeGoals = historicalFixture?.goals?.home;
      const awayGoals = historicalFixture?.goals?.away;
      const seasonLabel = String(historicalFixture?.league?.season ?? seasonYear);
      const compositeHistoricalId = `${pairKey || fixtureApiId}_${seasonLabel}_${historicalFixtureId}`;

      await upsertRow(
        tablesdb,
        databaseId,
        h2hTable,
        `h2h_${safeIdPart(pairKey || fixtureApiId)}_${safeIdPart(seasonLabel)}_${safeIdPart(historicalFixtureId)}`,
        {
          current_fixture_api_id: fixtureApiId,
          historical_fixture_api_id: compositeHistoricalId,
          home_team_api_id: String(historicalFixture?.teams?.home?.id ?? homeTeamId),
          away_team_api_id: String(historicalFixture?.teams?.away?.id ?? awayTeamId),
          pair_key: pairKey,
          kickoff_at: historicalFixture?.fixture?.date || null,
          home_score: homeGoals != null ? String(homeGoals) : null,
          away_score: awayGoals != null ? String(awayGoals) : null,
          winner: determineWinnerLabel(historicalFixture),
          status_short: historicalFixture?.fixture?.status?.short || 'NS',
          league_api_id: historicalFixture?.league?.id != null ? String(historicalFixture.league.id) : null,
          season: seasonLabel,
          created_at: now,
          updated_at: now,
        },
      );
      saved += 1;
    }
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

async function fetchStoredH2HRowsForFixture(tablesdb, databaseId, h2hTable, fixtureApiId, homeTeamId, awayTeamId) {
  return fetchH2hRowsForPair(tablesdb, databaseId, h2hTable, fixtureApiId, homeTeamId, awayTeamId);
}

function buildPrompt(fixture, h2hRows) {
  return [
    'You are a football prediction assistant.',
    'Use the fixture and h2h history to produce a single JSON object.',
    'Return valid JSON only.',
    'Required JSON keys: predicted_winner, confidence, confidence_label, picks.',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include: selection, confidence, reason.',
    'If the confidence is below 0.85, set reason to an empty string and do not add any explanation text.',
    'Never use phrases about limited data, small samples, missing history, insufficient evidence, or not enough matches as reason text for a 0.85+ confidence pick.',
    'The reason must be short, one sentence only, and should not include extra explanation.',
    'Prefer conservative non-straight-win markets such as Over/Under goals, Both Teams To Score, Double Chance, Draw, or No Bet.',
    "Don't generate straight-win selections like Home Win, Away Win, Team X to win, or bare team-name wins unless confidence is 0.99 or higher.",
    "Don't choose a straight-win pick unless you are extremely certain.",
    "Don't waste the response on straight-win markets when a conservative market is available.",
    'If the supplied H2H history is empty, use any fallback H2H history provided by the backend context.',
    'If no H2H history is available at all, do not invent it; use fixture context only and stay conservative.',
    'If the evidence is weak, lower confidence below 0.85 and leave reason empty.',
    'Focus on fixture context and h2h history when choosing the best conservative pick.',
    'Always provide one best conservative pick, and only provide reason text when confidence is 0.85 or higher.',
    'Confidence should be a decimal between 0 and 1.',
    'Use confidence_label values like high or medium only.',
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

function normalizeConfidenceLabel(label, confidence) {
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  if (numericConfidence >= 0.85) {
    return 'high';
  }

  const text = typeof label === 'string' ? label.trim().toLowerCase() : '';
  return text === 'high' ? 'high' : 'medium';
}

function parseConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.min(parsed, 10);
}

function parseMinimumH2hRows(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 2;
  }
  return parsed;
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
    'If confidence is below 0.85, reason must be an empty string.',
    'Never use phrases about limited data, small samples, missing history, insufficient evidence, or not enough matches as reason text for a 0.85+ confidence pick.',
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
  if (!text) {
    return '';
  }

  if (reasonLooksLikeLimitedEvidence(text)) {
    return '';
  }

  return text;
}

function reasonLooksLikeLimitedEvidence(reason) {
  const text = String(reason || '').toLowerCase();
  if (!text) {
    return false;
  }

  return (
    text.includes('limited data') ||
    text.includes('small sample') ||
    text.includes('not enough history') ||
    text.includes('insufficient') ||
    text.includes('lack of data') ||
    text.includes('no history') ||
    text.includes('missing h2h') ||
    text.includes('few matches') ||
    text.includes('few meetings') ||
    text.includes('weak evidence') ||
    text.includes('weak data')
  );
}

function normalizeReasonByConfidence(reason, confidence) {
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  if (numericConfidence < HIGH_CONFIDENCE_REASON_THRESHOLD) {
    return '';
  }

  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text || reasonLooksLikeLimitedEvidence(text)) {
    return '';
  }

  return text;
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
  messaging,
  topicId,
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
  const primaryConfidence = normalizeConfidence(primaryConfidenceSource);
  const primaryReason = normalizePrimaryReason(
    isAllowedNonWinSelection(primarySelection) || (isStraightWinSelection(primarySelection) && rawPrimaryConfidence >= 0.99)
      ? primaryPick?.reason
      : fallbackPick.reason,
    fixture,
    h2hRows,
    primarySelection,
  );
  const normalizedPrimaryReason = normalizeReasonByConfidence(
    primaryReason,
    primaryConfidence,
  );
  const predictedWinner = parsed.predicted_winner || null;

  if (!fixtureApiId) {
    return { saved: false, published: false, notified: false };
  }

  await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
    fixture_api_id: fixtureApiId,
    model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    prediction_text: normalizedPrimaryReason,
    predicted_winner: predictedWinner,
    confidence: primaryConfidence,
    confidence_label: normalizeConfidenceLabel(parsed.confidence_label, primaryConfidence),
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
    primary_reason: normalizedPrimaryReason,
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

  if (!messaging || !topicId || !shouldSendPredictionNotification(primaryConfidence)) {
    return { saved: true, published: true, notified: false };
  }

  try {
    if (typeof logFn === 'function') {
      logFn(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          prediction_id: `prediction_${fixtureApiId}`,
          stage: 'notification-send',
          message: 'Sending push notification for immediate publish.',
        }),
      );
    }

    const notificationCopy = buildNotificationCopy({
      fixtureName: `${fixture.home_team_name || 'Home'} vs ${fixture.away_team_name || 'Away'}`,
      market: primarySelection,
      confidence: primaryConfidence,
      seedValue: fixtureApiId,
    });

    await messaging.createPush({
      messageId: ID.unique(),
      title: notificationCopy.title,
      body: notificationCopy.body,
      topics: [topicId],
      data: {
        fixture_api_id: fixtureApiId,
        prediction_id: `prediction_${fixtureApiId}`,
        release_status: 'published',
        market: primarySelection,
        confidence: String(primaryConfidence),
      },
      draft: false,
    });

    await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
      release_status: 'published',
      published_at: startedAt,
      notification_sent: true,
      notification_sent_at: isoNow(),
      updated_at: isoNow(),
    });

    return { saved: true, published: true, notified: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isFcmConfigIssue =
      errorMessage.includes('JWT::encode') ||
      errorMessage.includes('Argument #2 ($key) must be of type string, null given') ||
      errorMessage.toLowerCase().includes('private key');

    if (typeof logFn === 'function') {
      logFn(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          prediction_id: `prediction_${fixtureApiId}`,
          stage: isFcmConfigIssue ? 'notification-config-error' : 'notification-error',
          message: errorMessage,
          hint: isFcmConfigIssue
            ? 'Check the Appwrite Messaging push provider. The FCM service-account private key is missing or not loaded.'
            : null,
        }),
      );
    } else {
      console.error(
        JSON.stringify({
          job: 'daily-sync-generate',
          fixture_api_id: fixtureApiId,
          prediction_id: `prediction_${fixtureApiId}`,
          stage: isFcmConfigIssue ? 'notification-config-error' : 'notification-error',
          message: errorMessage,
        }),
      );
    }

    return { saved: true, published: true, notified: false };
  }
}

async function generatePredictionsForBatch({
  tablesdb,
  databaseId,
  fixtureContexts,
  fixturesTable,
  h2hTable,
  predictionsTable,
  messaging,
  topicId,
  startedAt,
  logFn,
}) {
  let saved = 0;
  let failed = 0;
  let skipped = 0;
  let published = 0;
  let notified = 0;
  const concurrency = parseConcurrency(process.env.APPWRITE_PREDICTION_CONCURRENCY || 10);
  const minimumH2hRows = parseMinimumH2hRows(process.env.H2H_MIN_ROWS || 2);
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

          workingH2hRows = await fetchStoredH2HRowsForFixture(
            tablesdb,
            databaseId,
            h2hTable,
            fixtureApiId,
            fixture.home_team_api_id,
            fixture.away_team_api_id,
          );

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

      if (workingH2hRows.length < minimumH2hRows) {
        skipped += 1;
        logger(
          JSON.stringify({
            job: 'daily-sync-generate',
            fixture_api_id: fixtureApiId,
            stage: 'ai-skip',
            reason: 'insufficient-h2h-history',
            minimum_h2h_rows: minimumH2hRows,
            h2h_rows: workingH2hRows.length,
            message: 'Skipping AI prediction because the fixture does not have enough H2H data.',
          }),
        );
        return;
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
        messaging,
        topicId,
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
      skipped,
      published,
      notified,
    }),
  );

  return { saved, failed, skipped, published, notified };
}

export default async function main(context) {
  const { res, error: reportError } = context;
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const messaging = new Messaging(client);
  const { log: appwriteLog, error: appwriteError } = buildAppwriteLogger(context);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const teamsTable = required('APPWRITE_TABLE_TEAMS');
  const leaguesTable = required('APPWRITE_TABLE_LEAGUES');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

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

    const [fixturesDelete] = await Promise.all([
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
      message: 'Deleted existing fixtures before the next sync cycle. Preserved teams, leagues, and h2h history.',
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
      messaging,
      topicId,
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
      message: `Generated ${generationResult.saved} predictions from merged batch ${syncRunId}. Skipped ${generationResult.skipped} fixtures without H2H. Published ${generationResult.published} immediately and notified ${generationResult.notified}.`,
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
        predictions_skipped: generationResult.skipped,
        predictions_published: generationResult.published,
        predictions_notified: generationResult.notified,
        h2h_fixtures_processed: h2hFetchResult.h2hFetchedFixtures,
        h2h_rows_saved: h2hFetchResult.totalSaved,
      }),
    );

      return res.json({
        ok: true,
        cleaned: {
          fixtures: fixturesDelete?.total ?? null,
          teams: 0,
          leagues: 0,
          h2h: 0,
        },
      items_seen: String(fixtureContexts.length),
      items_saved: String(generationResult.saved),
      items_failed: String(generationResult.failed),
      items_skipped: String(generationResult.skipped),
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
