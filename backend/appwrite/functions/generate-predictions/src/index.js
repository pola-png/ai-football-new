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
    'CRITICAL REQUIREMENT: You MUST return ONLY valid JSON. No explanatory text, no markdown, no code blocks - just pure JSON.',
    'Use the fixture, odds, and h2h history to produce a single JSON object.',
    'MANDATORY JSON structure: {"predicted_winner": "string", "confidence": number, "confidence_label": "string", "picks": [{"selection": "string", "confidence": number, "reason": "string"}]}',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include: selection, confidence, reason.',
    'If the confidence is below 0.85, set reason to an empty string and do not add any explanation text.',
    'Never use phrases about limited data, small samples, missing history, insufficient evidence, or not enough matches as reason text for a 0.85+ confidence pick.',
    'Focus on low-odds markets such as over, under, gg/btts, corners, double chance 12, and throw-ins if the data exists.',
    'When choosing an Over/Under goals market, pick the line that best fits the h2h average goals. Use Over 3.5 if average is near 4, Over 2.5 if near 3, Over 1.5 if near 2. For Under markets, use Under 1.5 if average is below 1, Under 2.5 if average is near 2, Under 3.5 if near 3. Never default to a fixed line — always derive it from the data.',
    'IMPORTANT: For Over 3.5 and higher predictions, set confidence to maximum 0.83. For Under 2.5 and lower predictions, set confidence to maximum 0.83.',
    'Do not choose a straight win or draw selection unless you are at least 0.90 confident.',
    'If confidence is below 0.90, avoid home win, away win, draw, or team-name winner picks and choose a non-win market instead.',
    'If throw-in data is not available, skip it.',
    'If the evidence is weak, lower confidence below 0.85 and leave reason empty.',
    'Confidence should be a decimal between 0 and 1.',
    'Use confidence_label values like high or medium only.',
    'RESPOND WITH VALID JSON ONLY - NO OTHER TEXT.',
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
    `ODDS: ${JSON.stringify(oddsRows)}`,
    `H2H_HISTORY: ${JSON.stringify(h2hRows)}`,
    '',
    'REQUIRED JSON FORMAT (respond with this exact structure):',
    '{',
    '  "predicted_winner": "Team A",',
    '  "confidence": 0.83,',
    '  "confidence_label": "high",',
    '  "picks": [',
    '    {',
    '      "selection": "Over 3.5",',
    '      "confidence": 0.83,',
    '      "reason": "Both teams have averaged over 4 goals in recent h2h meetings."',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}

const HIGH_CONFIDENCE_REASON_THRESHOLD = 0.85;

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

function normalizePredictionReason(reason, confidence) {
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

function normalizeConfidenceLabel(label, confidence) {
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  if (numericConfidence >= 0.85) {
    return 'high';
  }

  const text = typeof label === 'string' ? label.trim().toLowerCase() : '';
  return text === 'high' ? 'high' : 'medium';
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
  const leagueId = Number(fixture?.league_api_id);
  const isWorldCup = leagueId === 1;

  const reasons = [];

  // World Cup matches always qualify for AI prediction
  if (isWorldCup) {
    reasons.push('world-cup-match');
    return {
      score: 100,
      shouldCallAi: true,
      reasons,
    };
  }

  // For regular matches, only require H2H if available
  if (h2hCount >= 1) {
    reasons.push('has-h2h-data');
    return {
      score: 100,
      shouldCallAi: true,
      reasons,
    };
  }

  // Skip only if no H2H and not World Cup
  return {
    score: 0,
    shouldCallAi: false,
    reasons: ['missing-h2h'],
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

    const fixtures = await fetchAllRows(tablesdb, databaseId, fixturesTable, [
      Query.equal('sync_run_id', syncRunId),
      Query.orderAsc('$createdAt'),
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
          content: [
            'You MUST return only valid JSON. No text before or after the JSON object.',
            'CRITICAL: Always include predicted_winner, confidence, confidence_label, and picks in your response.',
            'The picks array MUST contain exactly 1 object with selection, confidence, and reason fields.',
            'If confidence is below 0.85, reason must be an empty string.',
            'Never use phrases about limited data, small samples, missing history, insufficient evidence, or not enough matches as reason text for a 0.85+ confidence pick.',
            'ALWAYS return valid JSON or the system will fail.',
          ].join(' '),
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
        // If JSON parsing fails, create a basic prediction
        parsed = {
          predicted_winner: 'Unknown',
          confidence: 0.75,
          confidence_label: 'medium',
          picks: [{
            selection: 'Over 1.5',
            confidence: 0.75,
            reason: ''
          }],
        };
      }

      const primaryPick = pickAt(parsed.picks, 0);
      const primarySelection = primaryPick?.selection || parsed.predicted_winner || 'Over 1.5'; // Fallback selection
      const primaryConfidence = typeof primaryPick?.confidence === 'number'
        ? primaryPick.confidence
        : typeof parsed.confidence === 'number'
          ? parsed.confidence
          : 0.75; // Fallback confidence
      const primaryReason = normalizePredictionReason(primaryPick?.reason, primaryConfidence);

      const shouldPublishNow = shouldPublishNearKickoff(fixture.kickoff_at, new Date());
      const releaseStatus = shouldPublishNow ? 'published' : 'draft';
      const publishedAt = shouldPublishNow ? startedAt : null;
      const notificationSent = false;
      const notificationSentAt = null;

      await upsertRow(tablesdb, databaseId, predictionsTable, `prediction_${fixture.api_fixture_id}`, {
        fixture_api_id: fixture.api_fixture_id,
        model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
        prediction_text: primaryReason || 'AI prediction generated',
        predicted_winner: parsed.predicted_winner || 'TBD',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        confidence_label: normalizeConfidenceLabel(parsed.confidence_label, primaryConfidence),
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
