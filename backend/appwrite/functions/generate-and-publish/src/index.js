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

function buildPrompt(fixture, oddsRows, h2hRows) {
  return [
    'You are a football prediction assistant.',
    'Use the fixture, odds, and h2h history to produce a single JSON object.',
    'Return valid JSON only.',
    'Required JSON keys: prediction_text, predicted_winner, confidence, confidence_label, picks.',
    'The picks array must contain exactly 1 entry.',
    'Only provide one best prediction for this match.',
    'Each pick must include: market, selection, confidence, reason.',
    'Focus on low-odds markets such as over, under, gg/btts, corners, double chance 12, and throw-ins if the data exists.',
    'If throw-in data is not available, skip it.',
    'Confidence should be a percentage between 80% and 99%.',
    'Use confidence_label values like high, medium, or low.',
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
    `ODDS: ${JSON.stringify(oddsRows)}`,
    `H2H_HISTORY: ${JSON.stringify(h2hRows)}`,
    '',
    'JSON EXAMPLE:',
    '{',
    '  "prediction_text": "Team A have the stronger profile for a low-risk over/gg style card.",',
    '  "predicted_winner": "Team A",',
    '  "confidence": 86,',
    '  "confidence_label": "high",',
    '  "picks": [',
    '    {',
    '      "market": "over_1.5",',
    '      "selection": "Over 1.5",',
    '      "confidence": 91,',
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
    market: typeof pick.market === 'string' ? pick.market : null,
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

async function publishDuePredictions({ tablesdb, messaging, databaseId, predictionsTable, topicId }) {
  const now = isoNow();
  const rows = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
    Query.equal('release_status', 'draft'),
    Query.lessThanEqual('release_at', now),
    Query.orderAsc('release_at'),
  ]);

  let published = 0;
  const concurrency = parseConcurrency(process.env.APPWRITE_PREDICTION_CONCURRENCY || 1);

  await runWithConcurrency(rows, concurrency, async (row) => {
    const publishedAt = isoNow();
    try {
      await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
        release_status: 'published',
        published_at: publishedAt,
        updated_at: publishedAt,
      });

      await messaging.createPush({
        messageId: ID.unique(),
        title: 'New prediction is live',
        body: row.prediction_text || 'Your football prediction is ready.',
        topics: [topicId],
        data: {
          fixture_api_id: String(row.fixture_api_id),
          prediction_id: row.$id,
          release_status: 'published',
        },
        draft: false,
      });

      await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
        release_status: 'published',
        published_at: publishedAt,
        notification_sent: true,
        notification_sent_at: publishedAt,
        updated_at: publishedAt,
      });

      published += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          job: 'publish-due-predictions',
          fixture_api_id: row.fixture_api_id,
          prediction_id: row.$id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  return {
    items_seen: String(rows.length),
    items_saved: String(published),
  };
}

async function generatePredictionsForBatch({
  tablesdb,
  databaseId,
  fixtures,
  oddsTable,
  h2hTable,
  predictionsTable,
  startedAt,
}) {
  let saved = 0;
  let failed = 0;
  const concurrency = parseConcurrency(process.env.APPWRITE_PREDICTION_CONCURRENCY || 1);

  await runWithConcurrency(fixtures, concurrency, async (fixture) => {
    try {
      const oddsRows = await fetchRows(tablesdb, databaseId, oddsTable, [
        Query.equal('fixture_api_id', fixture.api_fixture_id),
        Query.orderAsc('$createdAt'),
      ]);

      const h2hRows = await fetchRows(tablesdb, databaseId, h2hTable, [
        Query.equal('current_fixture_api_id', fixture.api_fixture_id),
        Query.orderAsc('$createdAt'),
      ]);

      const prompt = buildPrompt(fixture, oddsRows, h2hRows);
      console.log(
        JSON.stringify({
          job: 'generate-predictions',
          fixture_api_id: fixture.api_fixture_id,
          odds_rows: oddsRows.length,
          h2h_rows: h2hRows.length,
          stage: 'before-deepseek',
        }),
      );
      const aiResponse = await deepSeekChat([
        {
          role: 'system',
          content: 'Return only valid JSON. Include prediction_text, predicted_winner, confidence, and market.',
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
          prediction_text: content,
          predicted_winner: null,
          confidence: null,
          confidence_label: null,
          picks: [],
          market: null,
        };
      }

      const primaryPick = pickAt(parsed.picks, 0);
      const predictionText = typeof parsed.prediction_text === 'string' ? parsed.prediction_text : content;
      const normalizedConfidence = normalizeConfidence(parsed.confidence);
      const normalizedPrimaryConfidence = normalizeConfidence(primaryPick?.confidence);

      await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixture.api_fixture_id}`, {
        fixture_api_id: fixture.api_fixture_id,
        model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
        prediction_text: predictionText,
        predicted_winner: parsed.predicted_winner || null,
        confidence: normalizedConfidence,
        market: parsed.market || null,
        confidence_label: parsed.confidence_label || null,
        home_team_name:
          fixture.home_team_name ?? fixture.homeTeamName ?? fixture.home_team?.name ?? null,
        away_team_name:
          fixture.away_team_name ?? fixture.awayTeamName ?? fixture.away_team?.name ?? null,
        home_team_logo_url:
          fixture.home_team_logo_url ?? fixture.homeTeamLogoUrl ?? fixture.home_team?.logo_url ?? null,
        away_team_logo_url:
          fixture.away_team_logo_url ?? fixture.awayTeamLogoUrl ?? fixture.away_team?.logo_url ?? null,
        kickoff_at: fixture.kickoff_at || null,
        match_status_short: fixture.status_short || null,
        match_status_long: fixture.status_long || null,
        primary_market: primaryPick?.market,
        primary_selection: primaryPick?.selection,
        primary_confidence: normalizedPrimaryConfidence,
        primary_reason: primaryPick?.reason,
        secondary_market: null,
        secondary_selection: null,
        secondary_confidence: null,
        secondary_reason: null,
        tertiary_market: null,
        tertiary_selection: null,
        tertiary_confidence: null,
        tertiary_reason: null,
        release_status: 'draft',
        release_at: fixture.kickoff_at || startedAt,
        generated_at: startedAt,
        published_at: null,
        notification_sent: false,
        notification_sent_at: null,
        created_at: startedAt,
        updated_at: isoNow(),
      });

      saved += 1;
    } catch (error) {
      failed += 1;
      console.error(
        JSON.stringify({
          job: 'generate-predictions',
          fixture_api_id: fixture.api_fixture_id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  return { saved, failed };
}

export default async function main({ res, error: reportError }) {
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const messaging = new Messaging(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

  const startedAt = isoNow();
  let generated = 0;

  try {
    const syncRun = await fetchLatestSyncRun(tablesdb, databaseId, syncRunsTable);
    const syncRunId = syncRun?.sync_run_id || null;

    const fixtures = await fetchAllRows(tablesdb, databaseId, fixturesTable, [
      Query.orderAsc('$createdAt'),
    ]);

    console.log(
      JSON.stringify({
        job: 'generate-predictions',
        sync_run_id: syncRunId,
        fixtures_seen: fixtures.length,
      }),
    );

    const generationResult = await generatePredictionsForBatch({
      tablesdb,
      databaseId,
      fixtures,
      oddsTable,
      h2hTable,
      predictionsTable,
      startedAt,
    });
    generated = generationResult.saved;

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(fixtures.length),
      items_saved: String(generated),
      message: `Generated ${generated} predictions from batch ${syncRunId}.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    const publishResult = await publishDuePredictions({
      tablesdb,
      messaging,
      databaseId,
      predictionsTable,
      topicId,
    });

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'publish-predictions',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: String(publishResult.items_seen),
      items_saved: String(publishResult.items_saved),
      message: `Published ${publishResult.items_saved} predictions and sent notifications.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return res.json({
      ok: true,
      sync_run_id: syncRunId,
      items_seen: String(fixtures.length),
      items_saved: String(generated),
      items_failed: String(generationResult.failed),
      published: publishResult.items_saved,
    });
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: '0',
      items_saved: String(generated),
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    reportError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
