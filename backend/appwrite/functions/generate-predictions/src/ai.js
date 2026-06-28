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
  'Use one conservative low-risk market choice from the fixture, odds, and h2h context.',
  'Prefer over/under, both teams to score, double chance, draw no bet, corners, or throw-ins when supported by the data.',
  'Do not default to under markets. Balance over and under choices based on the match data.',
  'Avoid straight win, away win, home win, or draw selections unless the evidence is very strong (confidence >= 0.90).',
  'Confidence bands: 0.80-0.86 moderate, 0.85-0.89 good, 0.90-0.99 very strong.',
  'Spread confidence values across the bands based on data quality. Do not give all predictions the same confidence.',
  'Do not output Under 2.5 or Over 3.5 unless confidence is at least 0.95.',
  'If confidence is below 0.95 for Under 2.5 or Over 3.5, fall back to Over 1.5, Over 2.5, GG, Double Chance, or Draw No Bet.',
  'If you do not know what to predict, prefer Over 1.5 or Over 2.5 first, then GG, Double Chance, or Draw No Bet instead of forcing Under 2.5 or Over 3.5.',
  'If confidence is below 0.89, reason must be empty.',
  'If confidence is 0.89 or above, reason must be short and factual.',
  'confidence must be a decimal from 0 to 1.',
  'confidence_label must be either high or medium.',
];

async function deepSeekChat(messages) {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(new Error('DeepSeek request timed out after 15000ms')), 15000);

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
        max_tokens: 700,
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

function buildPrompt(fixture, oddsRows, h2hRows) {
  return [
    ...CORE_PROMPT_RULES,
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
    `ODDS: ${JSON.stringify(oddsRows)}`,
    `H2H_HISTORY: ${JSON.stringify(h2hRows)}`,
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
  // Accept any confidence >= 0.80 — no hard minimum per selection type
  const numericConfidence = Number.isFinite(confidence) ? confidence : 0;
  const normalized = value.toLowerCase();

  if (/\bunder\s*2\.5\b/.test(normalized) || /\bover\s*3\.5\b/.test(normalized)) {
    return numericConfidence >= 0.95;
  }

  if (
    /\bunder\s*1\.5\b/.test(normalized) ||
    /\bover\s*1\.5\b/.test(normalized) ||
    /\bover\s*2\.5\b/.test(normalized)
  ) {
    return numericConfidence >= 0.85;
  }

  return numericConfidence >= 0.81;
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

  if (typeof logFn === 'function') {
    logFn(JSON.stringify({
      job: 'generate-predictions',
      fixture_api_id: fixtureApiId || null,
      stage: 'ai-request',
      message: 'Sending prediction request to DeepSeek.',
    }));
  }

  let aiResponse = await deepSeekChat(messages);
  let content = aiResponse?.choices?.[0]?.message?.content || '';
  let parsed = parsePredictionJson(content);

  if (!parsed) {
    if (typeof logFn === 'function') {
      logFn(JSON.stringify({
        job: 'generate-predictions',
        fixture_api_id: fixtureApiId || null,
        stage: 'ai-repair',
        message: 'Initial AI response was not clean JSON. Sending repair prompt.',
      }));
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
    logFn(JSON.stringify({
      job: 'generate-predictions',
      fixture_api_id: fixtureApiId || null,
      stage: 'ai-complete',
      parsed_ok: Boolean(parsed),
      preview: resolvePredictionText(parsed, content).slice(0, 120),
    }));
  }

  return {
    aiResponse,
    rawContent: content,
    parsed: normalizePredictionShape(parsed),
    parsedOk: Boolean(parsed),
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
