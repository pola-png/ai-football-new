import { Client, TablesDB, ID, Query } from 'node-appwrite';
import { sendPredictionTopicNotification } from '../_shared/firebase-notifications.js';

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
  const title = marketName === 'prediction'
    ? 'New prediction is live'
    : `High-confidence pick: ${marketName}`;
  const body = marketName === 'prediction'
    ? `${cta} ${fixtureName || 'A prediction'} is live with ${confidenceLabel} confidence.`
    : `${cta} ${fixtureName ? `${fixtureName}: ` : ''}${marketName} is live with ${confidenceLabel} confidence.`;

  return { title, body };
}

function isoNow() {
  return new Date().toISOString();
}

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

function toNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }

  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
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

async function upsertResultRow(tablesdb, databaseId, resultsTable, fixtureApiId, data) {
  const existing = await fetchAllRows(tablesdb, databaseId, resultsTable, [
    Query.equal('fixture_api_id', String(fixtureApiId)),
  ]);
  const existingRow = existing[0] || null;

  if (existingRow?.$id) {
    return upsertRow(tablesdb, databaseId, resultsTable, existingRow.$id, data);
  }

  return tablesdb.createRow({
    databaseId,
    tableId: resultsTable,
    rowId: ID.unique(),
    data: {
      fixture_api_id: String(fixtureApiId),
      ...data,
    },
  });
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  if (row.data && typeof row.data === 'object') {
    return {
      ...row.data,
      $id: row.$id ?? row.data.$id ?? null,
      $createdAt: row.$createdAt ?? row.data.$createdAt ?? null,
      $updatedAt: row.$updatedAt ?? row.data.$updatedAt ?? null,
    };
  }

  return row;
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

    const pageRows = (result.rows || []).map(normalizeRow);
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

function isFinalStatus(statusShort) {
  const normalized = String(statusShort || '').toUpperCase();
  return new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'PST', 'WO']).has(normalized);
}

function isVoidStatus(statusShort) {
  const normalized = String(statusShort || '').toUpperCase();
  return new Set(['CANC', 'ABD', 'PST', 'WO', 'AWD', 'INT']).has(normalized);
}

function shouldPublishPrediction(row, now) {
  if (String(row.release_status || '').toLowerCase() !== 'draft') {
    return false;
  }

  const kickoffAt = parseDate(row.kickoff_at);
  if (!kickoffAt) {
    return false;
  }

  const fourteenHoursFromNow = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  return kickoffAt.getTime() <= fourteenHoursFromNow.getTime();
}

function needsOutcomeRefresh(row, now) {
  const kickoffAt = parseDate(row.kickoff_at);
  if (!kickoffAt) return false;

  // Must have kicked off already
  if (kickoffAt.getTime() > now.getTime()) return false;

  // Already has a final outcome — no need to recheck
  if (isFinalStatus(row.match_status_short) && row.match_outcome) return false;

  return true;
}

function needsOutcomeRefreshWithinWindow(row, now, lookbackHours) {
  if (!needsOutcomeRefresh(row, now)) {
    return false;
  }

  if (!Number.isFinite(lookbackHours) || lookbackHours <= 0) {
    return true;
  }

  const kickoffAt = parseDate(row.kickoff_at);
  if (!kickoffAt) {
    return false;
  }

  const windowStart = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  return kickoffAt.getTime() >= windowStart.getTime();
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function fetchFixturesByIds(ids, logFn) {
  const uniqueIds = [...new Set(ids.map((value) => String(value || '').trim()).filter(Boolean))];
  const fixtureMap = new Map();

  if (uniqueIds.length === 0) {
    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        stage: 'fixture-fetch-skip',
        reason: 'no-fixture-ids',
      }));
    }
    return fixtureMap;
  }

  const baseUrl = required('API_FOOTBALL_BASE_URL').replace(/\/$/, '');
  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'fixture-fetch-start',
      total_ids: uniqueIds.length,
    }));
  }

  for (const batch of chunkArray(uniqueIds, 20)) {
    const url = new URL(`${baseUrl}/fixtures`);
    url.searchParams.set('ids', batch.join('-'));

    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        stage: 'fixture-fetch-batch-start',
        batch_size: batch.length,
        request_url: url.toString(),
      }));
    }

    const response = await fetch(url.toString(), {
      headers: buildApiFootballHeaders(),
    });

    if (!response.ok) {
      if (typeof logFn === 'function') {
        logFn(JSON.stringify({
          job: 'publish-and-maintain',
          stage: 'fixture-fetch-batch-error',
          batch_size: batch.length,
          status: response.status,
        }));
      }
      throw new Error(`API-Football request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const fixtures = Array.isArray(payload?.response) ? payload.response : [];

    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        stage: 'fixture-fetch-batch-complete',
        batch_size: batch.length,
        fixtures_received: fixtures.length,
      }));
    }

    for (const fixture of fixtures) {
      const fixtureId = fixture?.fixture?.id ?? fixture?.id ?? null;
      if (fixtureId != null) {
        fixtureMap.set(String(fixtureId), fixture);
      }
    }
  }

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'fixture-fetch-complete',
      fixtures_found: fixtureMap.size,
    }));
  }

  return fixtureMap;
}

function toNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function determineOutcome(homeGoals, awayGoals) {
  if (homeGoals == null || awayGoals == null) {
    return null;
  }

  if (homeGoals > awayGoals) {
    return 'home';
  }

  if (awayGoals > homeGoals) {
    return 'away';
  }

  return 'draw';
}

// Maps goal scores to the results table enum (pending, win, loss, push, void).
// win = home won, loss = away won, push = draw, void = cancelled/abandoned.
function toResultsOutcome(matchOutcome) {
  const outcome = String(matchOutcome || '').toLowerCase();
  if (outcome === 'void') return 'void';
  if (outcome === 'home') return 'win';   // home team won
  if (outcome === 'away') return 'loss';  // away team won (home lost)
  if (outcome === 'draw') return 'push';  // draw
  return 'pending';
}

function buildScoreFields(fixture) {
  return {
    current_home_goals: toTextNumber(fixture?.goals?.home),
    current_away_goals: toTextNumber(fixture?.goals?.away),
    halftime_home_goals: toTextNumber(fixture?.score?.halftime?.home),
    halftime_away_goals: toTextNumber(fixture?.score?.halftime?.away),
    fulltime_home_goals: toTextNumber(fixture?.score?.fulltime?.home),
    fulltime_away_goals: toTextNumber(fixture?.score?.fulltime?.away),
    extratime_home_goals: toTextNumber(fixture?.score?.extratime?.home),
    extratime_away_goals: toTextNumber(fixture?.score?.extratime?.away),
    penalty_home_goals: toTextNumber(fixture?.score?.penalty?.home),
    penalty_away_goals: toTextNumber(fixture?.score?.penalty?.away),
  };
}

async function publishPredictionRow({
  tablesdb,
  databaseId,
  predictionsTable,
  topicId,
  row,
  logFn,
}) {
  const now = isoNow();
  const primaryConfidence = Number.isFinite(Number(row.primary_confidence))
    ? Number(row.primary_confidence)
    : Number.isFinite(Number(row.confidence))
      ? Number(row.confidence)
      : 0;

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      fixture_api_id: row.fixture_api_id || null,
      prediction_id: row.$id || null,
      stage: 'publish-check',
      primary_selection: typeof row.primary_selection === 'string' ? row.primary_selection.trim() : null,
      has_reason: Boolean(row.primary_reason),
      notification_sent: Boolean(row.notification_sent),
    }));
  }

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      fixture_api_id: row.fixture_api_id || null,
      prediction_id: row.$id || null,
      stage: 'publish-update',
      message: 'Marking prediction as published.',
    }));
  }

  await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
    release_status: 'published',
    published_at: row.published_at || now,
    updated_at: now,
  });

  if (row.notification_sent || !shouldSendPredictionNotification(primaryConfidence)) {
    return { published: true, notified: false };
  }

  try {
    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: 'notification-send',
        message: 'Sending push notification.',
      }));
    }

    const notificationCopy = buildNotificationCopy({
      fixtureName: `${row.home_team_name || 'Home'} vs ${row.away_team_name || 'Away'}`,
      market: null,
      confidence: primaryConfidence,
      seedValue: row.fixture_api_id || row.$id || row.home_team_name || 'prediction',
    });

    await sendPredictionTopicNotification({
      topicId,
      title: notificationCopy.title,
      body: notificationCopy.body,
      data: {
        fixture_api_id: String(row.fixture_api_id || ''),
        prediction_id: row.$id,
        release_status: 'published',
        confidence: String(primaryConfidence),
      },
    });

    await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
      release_status: 'published',
      published_at: row.published_at || now,
      notification_sent: true,
      notification_sent_at: now,
      updated_at: now,
    });

    return { published: true, notified: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isFcmConfigIssue =
      errorMessage.includes('JWT::encode') ||
      errorMessage.includes('Argument #2 ($key) must be of type string, null given') ||
      errorMessage.toLowerCase().includes('private key');

    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: isFcmConfigIssue ? 'notification-config-error' : 'notification-error',
        message: errorMessage,
        hint: isFcmConfigIssue
          ? 'Check the Firebase service-account credentials. The FCM private key is missing or not loaded.'
          : null,
      }));
    } else {
      console.error(
        JSON.stringify({
          job: 'publish-and-maintain',
          fixture_api_id: row.fixture_api_id,
          prediction_id: row.$id,
          stage: isFcmConfigIssue ? 'notification-config' : 'notification',
          message: errorMessage,
        }),
      );
    }

    return { published: true, notified: false };
  }
}

async function refreshOutcomeRow({
  tablesdb,
  databaseId,
  predictionsTable,
  resultsTable,
  row,
  fixture,
  logFn,
}) {
  const now = isoNow();

  // No fixture found from API — if match is >3 hours past kickoff mark as void
  if (!fixture) {
    const kickoffAt = parseDate(row.kickoff_at);
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    if (kickoffAt && kickoffAt.getTime() < threeHoursAgo.getTime()) {
      await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
        match_status_short: row.match_status_short || 'VOID',
        match_outcome: 'void',
        result_checked_at: now,
        updated_at: now,
      });
      await upsertResultRow(tablesdb, databaseId, resultsTable, row.fixture_api_id, {
        outcome: 'void',
        checked_at: now,
        final_status: 'VOID',
        created_at: row.created_at || now,
        updated_at: now,
      });
      if (typeof logFn === 'function') {
        logFn(JSON.stringify({
          job: 'publish-and-maintain',
          fixture_api_id: row.fixture_api_id || null,
          stage: 'outcome-void-no-fixture',
          message: 'Marked void — fixture not found from API and >3h past kickoff.',
        }));
      }
      return { updated: true, status_short: 'VOID', final: true, match_outcome: 'void' };
    }
    return { updated: false, reason: 'missing-fixture' };
  }

  const statusShort = fixture?.fixture?.status?.short || row.match_status_short || null;
  const statusLong = fixture?.fixture?.status?.long || row.match_status_long || null;
  const scoreFields = buildScoreFields(fixture);
  const homeGoals = toNumericValue(scoreFields.current_home_goals);
  const awayGoals = toNumericValue(scoreFields.current_away_goals);
  const finalHomeGoals = toNumericValue(scoreFields.fulltime_home_goals ?? scoreFields.current_home_goals);
  const finalAwayGoals = toNumericValue(scoreFields.fulltime_away_goals ?? scoreFields.current_away_goals);
  const finalStatus = isFinalStatus(statusShort);
  const voidStatus = isVoidStatus(statusShort);

  // Determine outcome
  let nextOutcome;
  if (voidStatus) {
    nextOutcome = 'void';
  } else if (finalStatus) {
    nextOutcome = (finalHomeGoals != null && finalAwayGoals != null)
      ? determineOutcome(finalHomeGoals, finalAwayGoals)
      : 'void';
  } else {
    nextOutcome = typeof row.match_outcome === 'string' ? row.match_outcome.trim() || null : null;
  }

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      fixture_api_id: row.fixture_api_id || null,
      prediction_id: row.$id || null,
      stage: 'outcome-refresh',
      status_short: statusShort,
      current_home_goals: homeGoals,
      current_away_goals: awayGoals,
      fulltime_home_goals: finalHomeGoals,
      fulltime_away_goals: finalAwayGoals,
      match_outcome: nextOutcome,
      final: finalStatus,
      void: voidStatus,
    }));
  }

  // Backfill team names if missing
  const teamNamePatch = (!row.home_team_name || !row.away_team_name) ? {
    home_team_name: row.home_team_name || fixture?.teams?.home?.name || null,
    away_team_name: row.away_team_name || fixture?.teams?.away?.name || null,
    home_team_logo_url: row.home_team_logo_url || fixture?.teams?.home?.logo || null,
    away_team_logo_url: row.away_team_logo_url || fixture?.teams?.away?.logo || null,
  } : {};

  await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
    match_status_short: statusShort,
    match_status_long: statusLong,
    ...scoreFields,
    match_outcome: nextOutcome,
    result_checked_at: now,
    updated_at: now,
    ...teamNamePatch,
  });

  if (finalStatus || voidStatus) {
    const resultOutcome = toResultsOutcome(nextOutcome);
    const resultWinner = (nextOutcome === 'void' || nextOutcome === 'draw')
      ? null
      : nextOutcome;

    await upsertResultRow(tablesdb, databaseId, resultsTable, row.fixture_api_id, {
      home_score: toTextNumber(finalHomeGoals ?? homeGoals),
      away_score: toTextNumber(finalAwayGoals ?? awayGoals),
      winner: resultWinner,
      outcome: resultOutcome,
      checked_at: now,
      final_status: statusShort,
      created_at: row.created_at || now,
      updated_at: now,
    });
  }

  return {
    updated: true,
    status_short: statusShort,
    final: finalStatus || voidStatus,
    match_outcome: nextOutcome,
    current_home_goals: homeGoals,
    current_away_goals: awayGoals,
  };
}

export default async function main({ res, error: reportError }) {
  const startedAt = isoNow();
  const log = (message) => {
    console.log(message);
  };
  const logError = (message) => {
    console.error(message);
  };

  let tablesdb = null;
  let databaseId = null;
  let syncRunsTable = null;
  let startedSuccessfully = false;

  try {
    const client = buildClient();
    tablesdb = new TablesDB(client);
    databaseId = required('APPWRITE_DATABASE_ID');
    const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
    const resultsTable = process.env.APPWRITE_TABLE_RESULTS || 'results';
    syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
    const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

    const now = new Date();
    const outcomeLookbackHours = Number.parseInt(process.env.OUTCOME_LOOKBACK_HOURS || '0', 10);

    startedSuccessfully = true;
    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'run-start',
      started_at: startedAt,
      outcome_lookback_hours: outcomeLookbackHours,
      results_table: resultsTable,
    }));

    const draftPredictions = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
      Query.equal('release_status', 'draft'),
      Query.orderAsc('kickoff_at'),
    ]);

    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'drafts-loaded',
      total_drafts: draftPredictions.length,
    }));

    const publishedPredictions = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
      Query.equal('release_status', 'published'),
      Query.orderAsc('kickoff_at'),
    ]);

    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'published-loaded',
      total_published: publishedPredictions.length,
    }));

    const publishCandidates = draftPredictions.filter((row) => shouldPublishPrediction(row, now));
    const outcomeCandidates = publishedPredictions.filter((row) => needsOutcomeRefreshWithinWindow(row, now, outcomeLookbackHours));

    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'candidates-ready',
      publish_candidates: publishCandidates.length,
      outcome_candidates: outcomeCandidates.length,
    }));

    let published = 0;
    let notified = 0;
    for (const row of publishCandidates) {
      log(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: 'publish-loop',
        message: 'Processing draft prediction for publication.',
      }));

      const result = await publishPredictionRow({
        tablesdb,
        databaseId,
        predictionsTable,
        topicId,
        row,
        logFn: log,
      });
      if (result.published) {
        published += 1;
      }
      if (result.notified) {
        notified += 1;
      }
    }

    const outcomeFixtureIds = [...new Set(outcomeCandidates
      .map((row) => String(row.fixture_api_id || '').trim())
      .filter(Boolean))];

    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'fixture-fetch-start',
      fixture_ids: outcomeFixtureIds.length,
    }));

    const fixtureMap = await fetchFixturesByIds(outcomeFixtureIds, log);
    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'fixture-fetch-complete',
      fixtures_found: fixtureMap.size,
    }));
    let outcomesUpdated = 0;

    for (const row of outcomeCandidates) {
      const fixture = fixtureMap.get(String(row.fixture_api_id || '').trim()) || null;

      // Backfill team names from live API data if missing on prediction row
      if (fixture && (!row.home_team_name || !row.away_team_name) && row.$id) {
        await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
          home_team_name: row.home_team_name || fixture?.teams?.home?.name || null,
          away_team_name: row.away_team_name || fixture?.teams?.away?.name || null,
          home_team_logo_url: row.home_team_logo_url || fixture?.teams?.home?.logo || null,
          away_team_logo_url: row.away_team_logo_url || fixture?.teams?.away?.logo || null,
          updated_at: isoNow(),
        });
      }
      log(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: 'outcome-loop',
        fixture_found: Boolean(fixture),
      }));

      if (!fixture) {
        log(JSON.stringify({
          job: 'publish-and-maintain',
          fixture_api_id: row.fixture_api_id || null,
          prediction_id: row.$id || null,
          stage: 'outcome-skip',
          reason: 'fixture-not-found-from-api-football',
        }));
        continue;
      }

      const result = await refreshOutcomeRow({
        tablesdb,
        databaseId,
        predictionsTable,
        resultsTable,
        row,
        fixture,
        logFn: log,
      });

      if (result.updated) {
        outcomesUpdated += 1;
      }
    }

    const outcomeWindowLabel = outcomeLookbackHours > 0
      ? `within the last ${outcomeLookbackHours} hours`
      : 'across all pending published matches';

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'publish-and-maintain',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(draftPredictions.length + publishedPredictions.length),
      items_saved: String(published),
      message: `Loaded ${draftPredictions.length} drafts and ${publishedPredictions.length} published rows. Published ${published} predictions, sent ${notified} notifications, and refreshed ${outcomesUpdated} match outcomes ${outcomeWindowLabel}.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'run-complete',
      published,
      notified,
      outcomes_updated: outcomesUpdated,
      outcome_lookback_hours: outcomeLookbackHours,
    }));

    return res.json({
      ok: true,
      items_seen: String(draftPredictions.length + publishedPredictions.length),
      drafts_seen: String(draftPredictions.length),
      published_seen: String(publishedPredictions.length),
      published: String(published),
      notified: String(notified),
      outcomes_updated: String(outcomesUpdated),
      outcome_lookback_hours: String(outcomeLookbackHours),
    });
  } catch (error) {
    logError(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'run-error',
      started_at: startedAt,
      started_successfully: startedSuccessfully,
      message: error instanceof Error ? error.message : String(error),
    }));

    if (tablesdb && databaseId && syncRunsTable) {
      try {
        await createRun(tablesdb, databaseId, syncRunsTable, {
          job_name: 'publish-and-maintain',
          status: 'failed',
          started_at: startedAt,
          finished_at: isoNow(),
          items_seen: '0',
          items_saved: '0',
          message: error instanceof Error ? error.message : String(error),
          created_at: isoNow(),
          updated_at: isoNow(),
        });
      } catch (runError) {
        logError(JSON.stringify({
          job: 'publish-and-maintain',
          stage: 'run-error-log-failed',
          message: runError instanceof Error ? runError.message : String(runError),
        }));
      }
    }

    reportError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
