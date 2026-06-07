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

function buildAppwriteLogger(context) {
  const log = typeof context?.log === 'function'
    ? (message) => context.log(message)
    : (message) => console.log(message);
  const error = typeof context?.error === 'function'
    ? (message) => context.error(message)
    : (message) => console.error(message);

  return { log, error };
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

function shouldPublishPrediction(row, now) {
  if (String(row.release_status || '').toLowerCase() !== 'draft') {
    return false;
  }

  const releaseAt = parseDate(row.release_at);
  if (releaseAt && releaseAt.getTime() <= now.getTime()) {
    return true;
  }

  const kickoffAt = parseDate(row.kickoff_at);
  if (!kickoffAt) {
    return false;
  }

  const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return kickoffAt.getTime() <= fourHoursFromNow.getTime();
}

function needsOutcomeRefresh(row, now) {
  const kickoffAt = parseDate(row.kickoff_at);
  if (!kickoffAt) {
    return false;
  }

  if (kickoffAt.getTime() > now.getTime()) {
    return false;
  }

  const resultCheckedAt = parseDate(row.result_checked_at);
  if (resultCheckedAt && isFinalStatus(row.match_status_short)) {
    return false;
  }

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
  messaging,
  topicId,
  row,
  logFn,
}) {
  const now = isoNow();
  const primarySelection = typeof row.primary_selection === 'string' ? row.primary_selection.trim() : '';
  const primaryReason = typeof row.primary_reason === 'string' ? row.primary_reason.trim() : '';

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      fixture_api_id: row.fixture_api_id || null,
      prediction_id: row.$id || null,
      stage: 'publish-check',
      primary_selection: primarySelection || null,
      has_reason: Boolean(primaryReason),
      notification_sent: Boolean(row.notification_sent),
    }));
  }

  if (!primarySelection || !primaryReason) {
    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: 'publish-skip',
        reason: 'missing-primary-selection-or-reason',
      }));
    }
    return { published: false, skipped: true };
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

  if (row.notification_sent) {
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

    await messaging.createPush({
      messageId: ID.unique(),
      title: 'New prediction is live',
      body: primaryReason,
      topics: [topicId],
      data: {
        fixture_api_id: String(row.fixture_api_id || ''),
        prediction_id: row.$id,
        release_status: 'published',
      },
      draft: false,
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
    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'publish-and-maintain',
        fixture_api_id: row.fixture_api_id || null,
        prediction_id: row.$id || null,
        stage: 'notification-error',
        message: error instanceof Error ? error.message : String(error),
      }));
    } else {
      console.error(
        JSON.stringify({
          job: 'publish-and-maintain',
          fixture_api_id: row.fixture_api_id,
          prediction_id: row.$id,
          stage: 'notification',
          message: error instanceof Error ? error.message : String(error),
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
  row,
  fixture,
  logFn,
}) {
  if (!fixture) {
    return { updated: false, reason: 'missing-fixture' };
  }

  const now = isoNow();
  const statusShort = fixture?.fixture?.status?.short || row.match_status_short || null;
  const statusLong = fixture?.fixture?.status?.long || row.match_status_long || null;
  const scoreFields = buildScoreFields(fixture);
  const homeGoals = toNumericValue(scoreFields.current_home_goals);
  const awayGoals = toNumericValue(scoreFields.current_away_goals);
  const finalHomeGoals = toNumericValue(scoreFields.fulltime_home_goals ?? scoreFields.current_home_goals);
  const finalAwayGoals = toNumericValue(scoreFields.fulltime_away_goals ?? scoreFields.current_away_goals);
  const finalStatus = isFinalStatus(statusShort);
  const existingOutcome = typeof row.match_outcome === 'string' ? row.match_outcome.trim() : '';
  const nextOutcome = finalStatus && finalHomeGoals != null && finalAwayGoals != null
    ? determineOutcome(finalHomeGoals, finalAwayGoals)
    : existingOutcome || null;

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'publish-and-maintain',
      fixture_api_id: row.fixture_api_id || null,
      prediction_id: row.$id || null,
      stage: 'outcome-refresh',
      status_short: statusShort,
      status_long: statusLong,
      current_home_goals: homeGoals,
      current_away_goals: awayGoals,
      fulltime_home_goals: finalHomeGoals,
      fulltime_away_goals: finalAwayGoals,
      match_outcome: nextOutcome,
      final: finalStatus,
    }));
  }

  await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
    match_status_short: statusShort,
    match_status_long: statusLong,
    ...scoreFields,
    match_outcome: nextOutcome,
    result_checked_at: now,
    updated_at: now,
  });

  return {
    updated: true,
    status_short: statusShort,
    final: finalStatus,
    match_outcome: nextOutcome,
    current_home_goals: homeGoals,
    current_away_goals: awayGoals,
  };
}

export default async function main({ res, error: reportError }) {
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const messaging = new Messaging(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

  const startedAt = isoNow();
  const now = new Date();
  const outcomeLookbackHours = Number.parseInt(process.env.OUTCOME_LOOKBACK_HOURS || '8', 10);

  const log = (message) => {
    console.log(message);
  };
  const logError = (message) => {
    console.error(message);
  };

  try {
    log(JSON.stringify({
      job: 'publish-and-maintain',
      stage: 'run-start',
      started_at: startedAt,
      outcome_lookback_hours: outcomeLookbackHours,
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
        messaging,
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
        row,
        fixture,
        logFn: log,
      });

      if (result.updated) {
        outcomesUpdated += 1;
      }
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'publish-and-maintain',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(draftPredictions.length + publishedPredictions.length),
      items_saved: String(published),
      message: `Loaded ${draftPredictions.length} drafts and ${publishedPredictions.length} published rows. Published ${published} predictions, sent ${notified} notifications, and refreshed ${outcomesUpdated} match outcomes within the last ${outcomeLookbackHours} hours.`,
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
      message: error instanceof Error ? error.message : String(error),
    }));

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

    reportError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
