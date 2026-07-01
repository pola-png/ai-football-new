import { Client, TablesDB, ID, Query } from 'node-appwrite';
import * as ai from './ai.js';
import * as save from './save.js';
import * as notify from './notify.js';
import { runPredictionEngine } from '../prediction-engine/src/index.js';
import { savePrediction } from '../prediction-engine/src/storage/savePrediction.js';
import { loadMarketAccuracies } from '../prediction-engine/src/learning/updateAccuracy.js';

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

async function fetchAllRows(tablesdb, databaseId, tableId, baseQueries, pageSize = 500) {
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

function classifySkipReason({ aiResult = null, error = null, saveResult = null }) {
  if (error) {
    return 'fetch_failed';
  }

  const rawContent = typeof aiResult?.rawContent === 'string' ? aiResult.rawContent.trim() : '';
  const parsedOk = Boolean(aiResult?.parsedOk);
  const primarySelection = typeof saveResult?.primarySelection === 'string'
    ? saveResult.primarySelection.trim()
    : '';
  const saved = Boolean(saveResult?.saved);

  if (!rawContent) {
    return 'empty_response';
  }

  if (!parsedOk) {
    if (/^[\s]*[\[{]/.test(rawContent) && !/[\]}]\s*$/.test(rawContent)) {
      return 'truncated_json';
    }

    return 'json_parse_failed';
  }

  if (!saved && !primarySelection) {
    return 'missing_primary_selection';
  }

  if (!saved && saveResult?.skipReason) {
    return saveResult.skipReason;
  }

  if (!saved) {
    return 'save_rejected';
  }

  return null;
}

function summarizeFixtureLog({
  fixtureApiId,
  fixtureName,
  leagueName,
  confidence,
  selection,
  reason,
  saved,
  skipped,
  skipReason,
  notificationSent,
  finishReason,
  completionTokens,
  repairAttempted,
  firstFinishReason,
  deepSeekResponse,
  rawContent,
  firstRawContent,
  preview,
}) {
  return {
    job: 'generate-predictions',
    stage: 'fixture.summary',
    status: saved ? 'saved' : (skipReason === 'fetch_failed' ? 'failed' : 'skipped'),
    fixture_api_id: fixtureApiId,
    fixture_name: fixtureName,
    league_name: leagueName,
    confidence: Number.isFinite(confidence) ? confidence : null,
    selection: selection || null,
    reason: reason || null,
    saved: Boolean(saved),
    skipped: Boolean(skipped),
    skip_reason: skipReason || null,
    notification_sent: Boolean(notificationSent),
    finish_reason: finishReason || null,
    first_finish_reason: firstFinishReason || null,
    completion_tokens: Number.isFinite(completionTokens) ? completionTokens : null,
    repair_attempted: Boolean(repairAttempted),
    deepseek_response: deepSeekResponse || null,
    first_raw_content: typeof firstRawContent === 'string' ? firstRawContent : '',
    raw_content: typeof rawContent === 'string' ? rawContent : '',
    preview: typeof preview === 'string' ? preview : 'Prediction details unavailable.',
  };
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
  const aiBatchSize = Math.max(1, Number.parseInt(process.env.AI_BATCH_SIZE || '5', 10));

  try {
    appwriteLog(JSON.stringify({
      level: 'info',
      job: 'generate-predictions',
      step: 'function.start',
      timestamp: isoNow(),
      syncRunsTable,
      predictionsTable,
      fixturesTable,
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

    const { accuracies: customAccuracies } = await loadMarketAccuracies(tablesdb, databaseId, syncRunsTable);

    appwriteLog(JSON.stringify({
      level: 'info',
      job: 'generate-predictions',
      step: 'fixture.loaded',
      timestamp: isoNow(),
      total_fixtures: fixtures.length,
      ai_batch_size: aiBatchSize,
    }));

    const cache = new Map();
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

      const batchResults = await Promise.all(fixtureBatch.map(async (fixture) => {
        const fixtureApiId = String(fixture?.api_fixture_id || '').trim();
        const fixtureName = String(fixture?.home_team_name || fixture?.away_team_name || fixture?.team_name || fixture?.name || '').trim() || null;
        const leagueName = String(fixture?.league_name || fixture?.league?.name || fixture?.league || '').trim() || null;
        const shouldPublishNow = shouldPublishNearKickoff(fixture?.kickoff_at, new Date());

        let aiResult = null;
        let saveResult = null;
        let notificationSent = false;
        let notificationSentAt = null;
        let error = null;
        try {
          const predictionResult = await runPredictionEngine({
            tablesdb,
            databaseId,
            tablesConfig: {
              oddsTable: process.env.APPWRITE_TABLE_FIXTURE_ODDS || 'fixture_odds',
              h2hTable: process.env.APPWRITE_TABLE_FIXTURE_H2H_HISTORY || 'fixture_h2h_history',
              standingsTable: process.env.APPWRITE_TABLE_STANDINGS || 'standings',
              teamStatsTable: process.env.APPWRITE_TABLE_TEAM_STATS || 'team_statistics',
            },
            fixtureDoc: fixture,
            customAccuracies,
            log: (msg) => appwriteLog(msg),
            cache,
          });

          aiResult = {
            rawContent: JSON.stringify(predictionResult.chosen),
            parsedOk: true,
            aiResponse: { model: 'rule-engine-v1' },
            parsed: {
              predicted_winner: predictionResult.chosen.predictedWinner || 'TBD',
              confidence: predictionResult.chosen.confidence,
              picks: [{
                selection: predictionResult.chosen.selection,
                confidence: predictionResult.chosen.confidence,
                reason: predictionResult.reason
              }]
            }
          };

          saveResult = await savePrediction({
            tablesdb,
            databaseId,
            predictionsTable,
            fixture,
            chosenPrediction: predictionResult.chosen,
            reason: predictionResult.reason,
            releaseStatus: shouldPublishNow ? 'published' : 'draft',
            publishedAt: shouldPublishNow ? startedAt : null,
          });

          if (saveResult.saved && shouldPublishNow && topicId && notify.shouldSendPredictionNotification(saveResult.primaryConfidence)) {
            try {
              await notify.sendPredictionNotification({
                topicId,
                fixture,
                confidence: saveResult.primaryConfidence,
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
            } catch (notifyError) {
              appwriteError(JSON.stringify({
                job: 'generate-predictions',
                fixture_api_id: fixtureApiId,
                prediction_id: `prediction_${fixtureApiId}`,
                stage: 'notification-error',
                message: notifyError instanceof Error ? notifyError.message : String(notifyError),
                stack: notifyError instanceof Error ? notifyError.stack : null,
                hasFirebaseJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
                hasFirebaseSplitEnv: Boolean(
                  process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID
                    && process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL
                    && process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
                ),
              }));
            }
          }
        } catch (caughtError) {
          error = caughtError;
        }

        const primaryConfidence = Number.isFinite(saveResult?.primaryConfidence)
          ? saveResult.primaryConfidence
          : typeof aiResult?.parsed?.confidence === 'number'
            ? aiResult.parsed.confidence
            : null;
        const selection = saveResult?.primarySelection
          || aiResult?.parsed?.picks?.[0]?.selection
          || null;
        const reason = saveResult?.primaryReason
          || aiResult?.parsed?.picks?.[0]?.reason
          || null;
        const skipReason = classifySkipReason({ aiResult, error, saveResult });
        const savedNow = Boolean(saveResult?.saved && !error);
        const skippedNow = !savedNow;
        const rawContent = typeof aiResult?.rawContent === 'string' ? aiResult.rawContent : '';
        const preview = error
          ? (error instanceof Error ? error.message : String(error))
          : ai.resolvePredictionText(aiResult?.parsed, rawContent).slice(0, 120);

        appwriteLog(JSON.stringify(summarizeFixtureLog({
          fixtureApiId,
          fixtureName,
          leagueName,
          confidence: primaryConfidence,
          selection,
          reason,
          saved: savedNow,
          skipped: skippedNow,
          skipReason,
          notificationSent,
          finishReason: aiResult?.finishReason || null,
          completionTokens: aiResult?.completionTokens,
          repairAttempted: aiResult?.repairAttempted,
          firstFinishReason: aiResult?.firstFinishReason || null,
          deepSeekResponse: aiResult?.aiResponse || null,
          rawContent,
          firstRawContent: aiResult?.firstRawContent || '',
          preview,
        })));

        if (error) {
          return {
            status: 'failed',
            fixtureApiId,
            primaryConfidence: null,
          };
        }

        if (!savedNow) {
          return {
            status: 'skipped',
            fixtureApiId,
            primaryConfidence: primaryConfidence ?? 0,
          };
        }

        return {
          status: 'saved',
          fixtureApiId,
          primaryConfidence: saveResult.primaryConfidence,
        };
      }));

      for (const value of batchResults) {
        if (value.status === 'failed') {
          failed += 1;
          continue;
        }

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
