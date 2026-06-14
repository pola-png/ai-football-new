const { Client, TablesDB, ID, Query } = require('node-appwrite');

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

function buildPrompt(fixture, oddsRows, h2hRows) {
  return [
    'You are a football prediction assistant.',
    'Use the fixture, odds, and h2h history to produce a single JSON object.',
    'Return valid JSON only.',
    'Required JSON keys: predicted_winner, confidence, confidence_label, picks.',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include: selection, confidence, reason.',
    'Focus on low-odds markets such as over, under, gg/btts, corners, double chance 12, and throw-ins if the data exists.',
    'Do not choose a straight win or draw selection unless you are at least 0.90 confident.',
    'If confidence is below 0.90, avoid home win, away win, draw, or team-name winner picks and choose a non-win market instead.',
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

function looksLikeJson(value) {
  return typeof value === 'string' && /^[\s]*[\[{]/.test(value);
}

function resolvePredictionText(parsed, content) {
  const primaryReason = typeof parsed?.picks?.[0]?.reason === 'string'
    ? parsed.picks[0].reason.trim()
    : '';
  if (primaryReason && !looksLikeJson(primaryReason)) {
    return primaryReason;
  }

  const jsonSummary = summarizePredictionJson(parsed);
  if (jsonSummary) {
    return jsonSummary;
  }

  if (typeof content === 'string' && content.trim() && !looksLikeJson(content)) {
    return content.trim();
  }

  return 'Prediction details unavailable.';
}

function summarizePredictionJson(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  const firstPick = picks[0];
  if (firstPick && typeof firstPick === 'object') {
    const selection = typeof firstPick.selection === 'string' ? firstPick.selection.trim() : '';
    const reason = typeof firstPick.reason === 'string' ? firstPick.reason.trim() : '';
    const parts = [
      selection,
      reason,
    ].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' - ');
    }
  }

  return typeof parsed.predicted_winner === 'string' && parsed.predicted_winner.trim()
    ? `Predicted winner: ${parsed.predicted_winner.trim()}`
    : '';
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

function countOddsSignals(oddsRows) {
  const rows = Array.isArray(oddsRows) ? oddsRows : [];
  let signals = 0;
  const marketNames = new Set();

  for (const row of rows) {
    const market = String(row?.market_name || '').toLowerCase();
    const selection = String(row?.selection_name || '').toLowerCase();
    if (market) {
      marketNames.add(market);
    }

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

  if (marketNames.size >= 2) {
    signals += 1;
  }

  return signals;
}

function scoreFixtureForAi({ fixture, oddsRows, h2hRows }) {
  const h2hCount = Array.isArray(h2hRows) ? h2hRows.length : 0;
  const oddsCount = Array.isArray(oddsRows) ? oddsRows.length : 0;
  const oddsSignals = countOddsSignals(oddsRows);

  let score = 0;
  const reasons = [];

  if (h2hCount <= 0) {
    return {
      score: 0,
      shouldCallAi: false,
      reasons: ['missing-h2h'],
    };
  }

  if (h2hCount >= 8) {
    score += 45;
    reasons.push('strong-h2h-volume');
  } else if (h2hCount >= 4) {
    score += 35;
    reasons.push('moderate-h2h-volume');
  } else {
    score += 20;
    reasons.push('light-h2h-volume');
  }

  if (oddsCount > 0) {
    score += 20;
    reasons.push('odds-present');
    if (oddsSignals > 0) {
      score += Math.min(15, oddsSignals * 5);
      reasons.push('non-win-odds-signals');
    }
  } else {
    reasons.push('no-odds');
  }

  const kickoffAt = fixture?.kickoff_at ? new Date(fixture.kickoff_at) : null;
  if (kickoffAt && !Number.isNaN(kickoffAt.getTime())) {
    score += 5;
    reasons.push('valid-kickoff');
  }

  return {
    score,
    shouldCallAi: score >= 45,
    reasons,
  };
}

async function main() {
  const client = buildClient();
  const tablesdb = new TablesDB(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const fixturesTable = required('APPWRITE_TABLE_FIXTURES');
  const oddsTable = required('APPWRITE_TABLE_FIXTURE_ODDS');
  const h2hTable = required('APPWRITE_TABLE_FIXTURE_H2H_HISTORY');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');

  const startedAt = isoNow();
  let saved = 0;
  let failed = 0;
  let skipped = 0;

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

    for (const fixtureRow of fixtures) {
      const fixture = fixtureRow;

      const oddsRows = await fetchRows(tablesdb, databaseId, oddsTable, [
        Query.equal('fixture_api_id', fixture.api_fixture_id),
        Query.orderAsc('$createdAt'),
      ]);

      const h2hRows = await fetchRows(tablesdb, databaseId, h2hTable, [
        Query.equal('current_fixture_api_id', fixture.api_fixture_id),
        Query.orderAsc('$createdAt'),
      ]);

      const aiGate = scoreFixtureForAi({ fixture, oddsRows, h2hRows });
      if (!aiGate.shouldCallAi) {
        skipped += 1;
        console.error(
          JSON.stringify({
            job: 'generate-predictions',
            fixture_api_id: fixture.api_fixture_id,
            stage: 'ai-skip',
            score: aiGate.score,
            reasons: aiGate.reasons,
            message: 'Skipping AI call because fixture did not meet the non-win threshold.',
          }),
        );
        continue;
      }

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

      const primaryPick = pickAt(parsed.picks, 0);
      const primaryReason = primaryPick?.reason?.trim() || '';
      const primarySelection = primaryPick?.selection || null;

      if (!primarySelection || !primaryReason) {
        failed += 1;
        console.error(
          JSON.stringify({
            job: 'generate-predictions',
            fixture_api_id: fixture.api_fixture_id,
            message: 'Skipping prediction without a primary pick.',
          }),
        );
        continue;
      }

      const shouldPublishNow = shouldPublishNearKickoff(fixture.kickoff_at, new Date());
      const releaseStatus = shouldPublishNow ? 'published' : 'draft';
      const publishedAt = shouldPublishNow ? startedAt : null;
      const notificationSent = false;
      const notificationSentAt = null;

      await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixture.api_fixture_id}`, {
        fixture_api_id: fixture.api_fixture_id,
        model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
        prediction_text: primaryReason,
        predicted_winner: parsed.predicted_winner || null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        confidence_label: parsed.confidence_label || null,
        kickoff_at: fixture.kickoff_at || null,
        match_status_short: fixture.status_short || null,
        match_status_long: fixture.status_long || null,
        primary_market: primarySelection,
        primary_selection: primarySelection,
        primary_confidence: primaryPick?.confidence,
        primary_reason: primaryReason,
        secondary_market: null,
        secondary_selection: null,
        secondary_confidence: null,
        secondary_reason: null,
        tertiary_market: null,
        tertiary_selection: null,
        tertiary_confidence: null,
        tertiary_reason: null,
        release_status: releaseStatus,
        release_at: startedAt,
        generated_at: startedAt,
        published_at: publishedAt,
        notification_sent: notificationSent,
        notification_sent_at: notificationSentAt,
        created_at: startedAt,
        updated_at: isoNow(),
      });

      saved += 1;
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      sync_run_id: syncRunId,
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: fixtures.length,
      items_saved: saved,
      message: `Generated ${saved} predictions from batch ${syncRunId}. Skipped ${skipped} fixtures before AI.`,
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
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'generate-predictions',
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: saved,
      items_saved: saved,
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
