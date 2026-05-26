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
    'The picks array must contain 2 to 3 entries.',
    'Each pick must include: market, selection, confidence, reason.',
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
    '  "prediction_text": "Team A have the stronger profile for a low-risk over/gg style card.",',
    '  "predicted_winner": "Team A",',
    '  "confidence": 0.86,',
    '  "confidence_label": "high",',
    '  "picks": [',
    '    {',
    '      "market": "over_1.5",',
    '      "selection": "Over 1.5",',
    '      "confidence": 0.91,',
    '      "reason": "Both teams create enough chances for at least two goals."',
    '    },',
    '    {',
    '      "market": "gg",',
    '      "selection": "Yes",',
    '      "confidence": 0.78,',
    '      "reason": "Both sides concede regularly."',
    '    },',
    '    {',
    '      "market": "double_chance_12",',
    '      "selection": "12",',
    '      "confidence": 0.69,',
    '      "reason": "A draw is less likely than one side winning."',
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

async function fetchExistingPrediction(tablesdb, databaseId, predictionsTable, fixtureApiId) {
  const rows = await fetchRows(tablesdb, databaseId, predictionsTable, [
    Query.equal('fixture_api_id', fixtureApiId),
    Query.limit(1),
  ]);
  return rows[0] || null;
}

async function publishDuePredictions({ tablesdb, messaging, databaseId, predictionsTable, topicId }) {
  const now = isoNow();
  const result = await tablesdb.listRows({
    databaseId,
    tableId: predictionsTable,
    queries: [
      Query.equal('release_status', 'draft'),
      Query.lessThanEqual('release_at', now),
      Query.limit(100),
      Query.orderAsc('release_at'),
    ],
    total: false,
  });

  const rows = result.rows || [];
  let published = 0;

  for (const row of rows) {
    const publishedAt = isoNow();
    await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
      ...row,
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
      ...row,
      release_status: 'published',
      published_at: publishedAt,
      notification_sent: true,
      notification_sent_at: publishedAt,
      updated_at: publishedAt,
    });

    published += 1;
  }

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

  for (const fixture of fixtures) {
    const existingPrediction = await fetchExistingPrediction(
      tablesdb,
      databaseId,
      predictionsTable,
      fixture.api_fixture_id,
    );

    if (existingPrediction) {
      continue;
    }

    const oddsRows = await fetchRows(tablesdb, databaseId, oddsTable, [
      Query.equal('fixture_api_id', fixture.api_fixture_id),
      Query.orderAsc('$createdAt'),
    ]);

    const h2hRows = await fetchRows(tablesdb, databaseId, h2hTable, [
      Query.equal('current_fixture_api_id', fixture.api_fixture_id),
      Query.orderAsc('$createdAt'),
    ]);

    const prompt = buildPrompt(fixture, oddsRows, h2hRows);
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
    const secondaryPick = pickAt(parsed.picks, 1);
    const tertiaryPick = pickAt(parsed.picks, 2);
    const predictionText = typeof parsed.prediction_text === 'string' ? parsed.prediction_text : content;

    await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixture.api_fixture_id}`, {
      fixture_api_id: fixture.api_fixture_id,
      model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
      prediction_text: predictionText,
      predicted_winner: parsed.predicted_winner || null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      market: parsed.market || null,
      confidence_label: parsed.confidence_label || null,
      kickoff_at: fixture.kickoff_at || null,
      match_status_short: fixture.status_short || null,
      match_status_long: fixture.status_long || null,
      primary_market: primaryPick?.market,
      primary_selection: primaryPick?.selection,
      primary_confidence: primaryPick?.confidence,
      primary_reason: primaryPick?.reason,
      secondary_market: secondaryPick?.market,
      secondary_selection: secondaryPick?.selection,
      secondary_confidence: secondaryPick?.confidence,
      secondary_reason: secondaryPick?.reason,
      tertiary_market: tertiaryPick?.market,
      tertiary_selection: tertiaryPick?.selection,
      tertiary_confidence: tertiaryPick?.confidence,
      tertiary_reason: tertiaryPick?.reason,
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
  }

  return saved;
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
    const syncRunId = syncRun?.sync_run_id;

    if (!syncRunId) {
      throw new Error('No successful sync_run_id found to generate predictions from.');
    }

    const fixtures = await fetchRows(tablesdb, databaseId, fixturesTable, [
      Query.equal('sync_run_id', syncRunId),
      Query.orderAsc('$createdAt'),
      Query.limit(100),
    ]);

    generated = await generatePredictionsForBatch({
      tablesdb,
      databaseId,
      fixtures,
      oddsTable,
      h2hTable,
      predictionsTable,
      startedAt,
    });

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
