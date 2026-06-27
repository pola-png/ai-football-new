import { Client, TablesDB, ID, Query } from 'node-appwrite';
import * as ai from './ai.js';
import * as save from './save.js';
import * as notify from './notify.js';

function buildAppwriteLogger(context) {
  const log = typeof context?.log === 'function'
    ? (message) => context.log(message)
    : (message) => console.log(message);
  const error = typeof context?.error === 'function'
    ? (message) => context.error(message)
    : (message) => console.error(message);

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
    .setEndpoint(required('APPWRITE_FUNCTION_ENDPOINT'))
    .setProject(required('APPWRITE_FUNCTION_PROJECT_ID'))
    .setKey(required('APPWRITE_FUNCTION_API_KEY'));
  return client;
}

function isoNow() {
  return new Date().toISOString();
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

async function fetchLatestSyncRun(tablesdb, databaseId, syncRunsTable) {
  const result = await tablesdb.listRows({
    databaseId,
    tableId: syncRunsTable,
    queries: [
      Query.equal('job_name', 'sync-fixtures'),
      Query.equal('status', 'success'),
      Query.orderDesc('$createdAt'),
      Query.limit(1),
    ],
    total: false,
  });

  return result.rows[0] || null;
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

function chunkArray(values, chunkSize) {
  const chunks = [];
  const safeChunkSize = Math.max(1, Number(chunkSize) || 1);

  for (let index = 0; index < values.length; index += safeChunkSize) {
    chunks.push(values.slice(index, index + safeChunkSize));
  }

  return chunks;
}

function shouldPublishNearKickoff(kickoffAtValue, now = new Date()) {
  if (!kickoffAtValue) {
    return false;
  }

  const kickoffAt = new Date(kickoffAtValue);
  if (Number.isNaN(kickoffAt.getTime())) {
    return false;
  }

  const timeDiffMs = kickoffAt.getTime() - now.getTime();
  return timeDiffMs >= 0 && timeDiffMs <= 8 * 60 * 60 * 1000;
}

export default async function main(context) {
  const { log: contextLog, error: contextError } = buildAppwriteLogger(context);
  const appwriteLog = contextLog;
  const appwriteError = contextError;

  appwriteLog(JSON.stringify({
    level: 'info',
    job: 'generate-predictions',
    step: 'bootstrap',
    timestamp: isoNow(),
    message: 'generate-predictions booted',
  }));

  const client = buildClient();
  const tablesdb = new TablesDB(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = process.env.APPWRITE_TOPIC_PREDICTIONS
    ? String(process.env.APPWRITE_TOPIC_PREDICTIONS).trim()
    : '';

  const startedAt = isoNow();
  let saved = 0;
  let failed = 0;
  let skipped = 0;
  let ultraConfidenceSaved = 0;
  let highConfidenceSaved = 0;
  const aiBatchSize = Math.max(1, Number.parseInt(process.env.AI_BATCH_SIZE || '12', 10));

  try {
    appwriteLog(JSON.stringify({
      level: 'info',
      job: 'generate-predictions',
      step: 'function.start',
      timestamp: isoNow(),
      syncRunsTable,
      predictionsTable,
      fixturesTable,
      oddsTable,
      h2hTable,
      topicPresent: Boolean(topicId),
    }));

    const syncRun = await fetchLatestSyncRun(tablesdb, databaseId, syncRunsTable);
    const syncRunId = syncRun?.sync_run_id;

    if (!syncRunId) {
      appwriteError(JSON.stringify({
        level: 'error',
        job: 'generate-predictions',
        step: 'missing_sync_run',
        timestamp: isoNow(),
        message: 'No successful sync_run_id found to generate predictions from.',
      }));
      throw new Error('No successful sync_run_id found to generate predictions from.');
    }

    const fixtures = await fetchAllRows(tablesdb, databaseId, fixturesTable, [
      Query.equal('sync_run_id', syncRunId),
      Query.orderAsc('$createdAt'),
    ]);

    appwriteLog(JSON.stringify({
      level: 'info',
      job: 'generate-predictions',
      step: 'fixture.loaded',
      timestamp: isoNow(),
      total_fixtures: fixtures.length,
      ai_batch_size: aiBatchSize,
    }));

    const fixtureBatches = chunkArray(fixtures, aiBatchSize);

    for (const [batchIndex, fixtureBatch] of fixtureBatches.entries()) {
      appwriteLog(JSON.stringify({
        level: 'info',
        job: 'generate-predictions',
        step: 'batch.start',
        timestamp: isoNow(),
        batch_index: batchIndex,
        batch_size: fixtureBatch.length,
      }));

      const batchResults = await Promise.allSettled(fixtureBatch.map(async (fixture) => {
        const fixtureApiId = fixture.api_fixture_id;

        const [oddsRows, h2hRows] = await Promise.all([
          fetchRows(tablesdb, databaseId, oddsTable, [
            Query.equal('fixture_api_id', fixtureApiId),
            Query.orderAsc('$createdAt'),
          ]),
          fetchRows(tablesdb, databaseId, h2hTable, [
            Query.equal('current_fixture_api_id', fixtureApiId),
            Query.orderAsc('$createdAt'),
          ]),
        ]);

        const shouldPublishNow = shouldPublishNearKickoff(fixture.kickoff_at, new Date());
        const aiResult = await ai.requestAiPrediction({
          fixtureApiId,
          prompt: ai.buildPrompt(fixture, oddsRows, h2hRows),
          fixture,
          logFn: appwriteLog,
        });

        const saveResult = await save.savePredictionRow({
          tablesdb,
          databaseId,
          predictionsTable,
          fixture,
          aiResponse: aiResult.aiResponse,
          parsed: aiResult.parsed,
          startedAt,
          releaseStatus: shouldPublishNow ? 'published' : 'draft',
          publishedAt: shouldPublishNow ? startedAt : null,
        });

        if (!saveResult.saved) {
          return { status: 'skipped', fixtureApiId };
        }

        const primaryConfidence = saveResult.primaryConfidence;
        let notificationSent = false;
        let notificationSentAt = null;

        if (shouldPublishNow && topicId && notify.shouldSendPredictionNotification(primaryConfidence)) {
          try {
            await notify.sendPredictionNotification({
              topicId,
              fixture,
              confidence: primaryConfidence,
              fixtureApiId,
              predictionId: saveResult.predictionId,
            });

            notificationSent = true;
            notificationSentAt = isoNow();

            await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixtureApiId}`, {
              notification_sent: true,
              notification_sent_at: notificationSentAt,
              updated_at: isoNow(),
            });
          } catch (error) {
            appwriteError(JSON.stringify({
              job: 'generate-predictions',
              fixture_api_id: fixtureApiId,
              prediction_id: `prediction_${fixtureApiId}`,
              stage: 'notification-error',
              message: error instanceof Error ? error.message : String(error),
            }));
          }
        }

        return {
          status: 'saved',
          fixtureApiId,
          primaryConfidence,
          notificationSent,
        };
      }));

      for (const result of batchResults) {
        if (result.status !== 'fulfilled') {
          failed += 1;
          appwriteError(JSON.stringify({
            job: 'generate-predictions',
            stage: 'batch.fixture.failed',
            timestamp: isoNow(),
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }));
          continue;
        }

        const value = result.value;
        if (value.status === 'skipped') {
          skipped += 1;
          continue;
        }

        if (value.status === 'saved') {
          saved += 1;
          if (value.primaryConfidence >= 0.87) {
            ultraConfidenceSaved += 1;
          } else if (value.primaryConfidence >= 0.85) {
            highConfidenceSaved += 1;
          }
        }
      }

      appwriteLog(JSON.stringify({
        level: 'info',
        job: 'generate-predictions',
        step: 'batch.complete',
        timestamp: isoNow(),
        batch_index: batchIndex,
        batch_size: fixtureBatch.length,
        saved,
        failed,
        skipped,
      }));
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(saved),
      message: `Generated ${saved} predictions from batch ${syncRunId}. Skipped ${skipped} fixtures before AI. Confidence breakdown: >=0.87 ${ultraConfidenceSaved}, >=0.85 ${highConfidenceSaved}.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return {
      ok: true,
      sync_run_id: syncRunId,
      items_seen: fixtures.length,
      items_saved: saved,
      skipped: skipped,
    };
  } catch (error) {
    appwriteError(JSON.stringify({
      level: 'error',
      job: 'generate-predictions',
      step: 'function.failed',
      timestamp: isoNow(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }));

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(saved),
      items_saved: String(saved),
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    throw error;
  }
}
