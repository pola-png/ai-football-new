function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isWorldCupCompetitionName(value) {
  const text = String(value || '').toLowerCase();
  return (
    text.includes('world cup') ||
    text.includes('fifa world cup') ||
    text.includes("women's world cup") ||
    text.includes('womens world cup')
  );
}

const CORE_PROMPT_RULES = [
  'You are a football prediction engine.',
  'Return exactly one valid JSON object and nothing else.',
  'Use double quotes only and do not use markdown, code fences, labels, bullet points, or commentary.',
  'The output must begin with { and end with }. Do not output trailing commas, multiple objects, or extra keys.',
  'Follow this schema exactly: {"predicted_winner":"string","confidence":0.0,"confidence_label":"high","picks":[{"selection":"string","confidence":0.0,"reason":"string"}]}',
  'The picks array must contain exactly one object.',
  'Use one conservative low-risk market choice from the fixture and h2h context.',
  'Primary preference order when the model is unsure: Over 2.5, Over 1.5, GG, NG, Under 4.5, Double Chance, Draw No Bet.',
  'Prefer over markets before double chance. Double chance is a later fallback, not the default safe answer.',
  'Do not default to under markets. Balance over and under choices based on the match data.',
  'Avoid straight win, away win, home win, or draw selections unless the evidence is very strong (confidence >= 0.90).',
  'Confidence bands: 0.80-0.86 moderate, 0.85-0.89 good, 0.90-0.99 very strong.',
  'Spread confidence values across the bands based on data quality. Do not give all predictions the same confidence.',
  'Do not output Under 2.5 or Over 3.5 unless confidence is at least 0.95.',
  'Do not use fallback picks. Choose the single best supported market from the data.',
  'Do not overuse Double Chance. Use it only when the match data does not support a stronger over or goal-based market.',
  'The top-level confidence must equal picks[0].confidence.',
  'If confidence is below 0.89, reason must be empty.',
  'If confidence is 0.89 or above, reason must be short and factual.',
  'confidence must be a decimal from 0 to 1.',
  'confidence_label must be either high or medium.',
];

async function deepSeekChat(messages) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const timeout = new AbortController();
  const timeoutMs = Math.max(15000, Number.parseInt(process.env.DEEPSEEK_TIMEOUT_MS || '60000', 10) || 60000);
  const timeoutId = setTimeout(() => timeout.abort(new Error(`DeepSeek request timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${required('DEEPSEEK_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      signal: timeout.signal,
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages,
        response_format: {
          type: 'json_object',
        },
        temperature: 0,
        max_tokens: Math.max(1200, Number.parseInt(process.env.DEEPSEEK_MAX_TOKENS || '1800', 10) || 1800),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek request failed with status ${response.status}: ${text}`);
    }

    return response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`DeepSeek fetch failed for ${baseUrl}/chat/completions: ${message}`);
    wrapped.cause = error;
    throw wrapped;
  } finally {
    clearTimeout(timeoutId);
  }
}

function pickFields(source, keys) {
  const result = {};
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') {
      result[key] = value;
    }
  }

  return result;
}

function compactFixtureForPrompt(fixture) {
  return pickFields(fixture, [
    'api_fixture_id',
    'league_api_id',
    'league_name',
    'country',
    'season',
    'round',
    'kickoff_at',
    'timezone',
    'status_short',
    'status_long',
    'home_team_name',
    'away_team_name',
    'home_goals',
    'away_goals',
    'venue_name',
    'venue_city',
  ]);
}

function compactH2hForPrompt(h2hRows) {
  const safeRows = Array.isArray(h2hRows) ? h2hRows : [];
  const limit = Math.max(0, Number.parseInt(process.env.AI_PROMPT_H2H_LIMIT || '5', 10) || 5);

  return safeRows.slice(0, limit).map((row) => pickFields(row, [
    'fixture_api_id',
    'current_fixture_api_id',
    'league_name',
    'match_date',
    'kickoff_at',
    'home_team_name',
    'away_team_name',
    'home_goals',
    'away_goals',
    'status_short',
    'status_long',
    'winner_team_name',
  ]));
}

function buildPrompt(fixture, h2hRows) {
  const promptFixture = compactFixtureForPrompt(fixture);
  const promptH2h = compactH2hForPrompt(h2hRows);

  return [
    ...CORE_PROMPT_RULES,
    '',
    `FIXTURE: ${JSON.stringify(promptFixture)}`,
    `H2H_HISTORY: ${JSON.stringify(promptH2h)}`,
    '',
    'Return only the JSON object, with no surrounding text.',
  ].join('\n');
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

function normalizePredictionReason(reason, confidence) {
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  if (numericConfidence < 0.89) {
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

function shouldKeepSelection(selection, confidence) {
  const value = String(selection || '').trim();
  if (!value) {
    return false;
  }
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  const normalized = value.toLowerCase();

  if (
    /\bunder\s*2\.5\b/.test(normalized) ||
    /\bunder\s*3\.5\b/.test(normalized) ||
    /\bover\s*3\.5\b/.test(normalized)
  ) {
    return numericConfidence >= 0.95;
  }

  return true;
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

function summarizePredictionJson(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
  const firstPick = picks[0];
  if (firstPick && typeof firstPick === 'object') {
    const selection = typeof firstPick.selection === 'string' ? firstPick.selection.trim() : '';
    const reason = typeof firstPick.reason === 'string' ? firstPick.reason.trim() : '';
    const parts = [selection, reason].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' - ');
    }
  }

  return typeof parsed.predicted_winner === 'string' && parsed.predicted_winner.trim()
    ? `Predicted winner: ${parsed.predicted_winner.trim()}`
    : '';
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

function parsePredictionJson(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) {
    return null;
  }

  const fenceMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : value;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const firstBracket = candidate.indexOf('[');
  const lastBracket = candidate.lastIndexOf(']');
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace
      ? candidate.slice(firstBrace, lastBrace + 1)
      : firstBracket >= 0 && lastBracket > firstBracket
        ? candidate.slice(firstBracket, lastBracket + 1)
        : candidate;

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePredictionShape(parsed) {
  const safe = parsed && typeof parsed === 'object' ? parsed : {};
  const picks = Array.isArray(safe.picks) ? safe.picks : [];

  return {
    predicted_winner:
      typeof safe.predicted_winner === 'string' ? safe.predicted_winner : null,
    confidence: typeof safe.confidence === 'number' ? safe.confidence : null,
    confidence_label:
      typeof safe.confidence_label === 'string' ? safe.confidence_label : null,
    picks: picks.map((pick) => ({
      selection: typeof pick?.selection === 'string' ? pick.selection : null,
      confidence: typeof pick?.confidence === 'number' ? pick.confidence : null,
      reason: typeof pick?.reason === 'string' ? pick.reason : null,
    })),
  };
}

function hasUsablePrimarySelection(parsed) {
  const normalized = normalizePredictionShape(parsed);
  const primaryPick = pickAt(normalized.picks, 0);
  const primaryConfidence =
    typeof primaryPick?.confidence === 'number'
      ? primaryPick.confidence
      : typeof normalized.confidence === 'number'
        ? normalized.confidence
        : 0;

  return Boolean(
    typeof primaryPick?.selection === 'string'
      && primaryPick.selection.trim()
      && shouldKeepSelection(primaryPick.selection, primaryConfidence)
  );
}

function buildRepairPrompt({ fixture, rawContent }) {
  const promptFixture = compactFixtureForPrompt(fixture);

  return [
    ...CORE_PROMPT_RULES,
    'Repair or regenerate the prediction as one valid JSON object using exactly one pick.',
    'The picks array must contain one object with a non-empty selection.',
    'Do not explain the repair.',
    '',
    `FIXTURE: ${JSON.stringify(promptFixture)}`,
    `BROKEN_OR_EMPTY_OUTPUT: ${JSON.stringify(String(rawContent || '').slice(0, 6000))}`,
    '',
    'Return only the valid JSON object now.',
  ].join('\n');
}

function scoreFixtureForAi({ fixture }) {
  const leagueId = Number(fixture?.league_api_id);
  const leagueName = fixture?.league_name || fixture?.name || fixture?.leagueName || '';
  const isWorldCup = leagueId === 1 || isWorldCupCompetitionName(leagueName);
  const reasons = isWorldCup ? ['world-cup-match'] : ['ai-enabled'];

  return {
    score: isWorldCup ? 100 : 50,
    shouldCallAi: true,
    reasons,
  };
}

async function requestAiPrediction({ fixtureApiId, prompt, fixture, logFn }) {
  const systemPrompt = [
    ...CORE_PROMPT_RULES,
  ].join(' ');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  let aiResponse = await deepSeekChat(messages);
  let choice = aiResponse?.choices?.[0] || {};
  let content = choice?.message?.content || '';
  let parsed = parsePredictionJson(content);
  let repairAttempted = false;
  let firstRawContent = content;
  let firstFinishReason = choice?.finish_reason || null;

  if (!hasUsablePrimarySelection(parsed)) {
    repairAttempted = true;
    const repairMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildRepairPrompt({ fixture, rawContent: content }) },
    ];

    aiResponse = await deepSeekChat(repairMessages);
    choice = aiResponse?.choices?.[0] || {};
    content = choice?.message?.content || '';
    parsed = parsePredictionJson(content);
  }

  return {
    aiResponse,
    rawContent: content,
    firstRawContent,
    firstFinishReason,
    repairAttempted,
    finishReason: choice?.finish_reason || null,
    completionTokens: typeof aiResponse?.usage?.completion_tokens === 'number'
      ? aiResponse.usage.completion_tokens
      : null,
    parsed: normalizePredictionShape(parsed),
    parsedOk: Boolean(parsed),
    fixtureName: String(fixture?.home_team_name || fixture?.away_team_name || fixture?.team_name || fixture?.name || '').trim() || null,
    leagueName: String(fixture?.league_name || fixture?.league?.name || fixture?.league || '').trim() || null,
  };
}

export {
  buildPrompt,
  deepSeekChat,
  normalizeConfidenceLabel,
  normalizePredictionReason,
  normalizePredictionShape,
  parsePredictionJson,
  pickAt,
  requestAiPrediction,
  resolvePredictionText,
  scoreFixtureForAi,
  shouldKeepSelection,
};
