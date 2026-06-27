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
  const outputSchema = {
    predicted_winner: 'string',
    confidence: 0.0,
    confidence_label: 'high',
    picks: [
      {
        selection: 'string',
        confidence: 0.0,
      },
    ],
  };

  return [
    'You are a football prediction assistant.',
    'Return exactly one JSON object and nothing else.',
    'Do not use markdown, code fences, bullet points, labels, or commentary.',
    'The output must begin with { and end with }.',
    'Use double quotes for every key and string value.',
    'Do not output trailing commas, multiple JSON objects, or extra keys.',
    'Follow this shape exactly: ' + JSON.stringify(outputSchema),
    'The picks array must contain exactly one object.',
    'Use one conservative low-risk market choice from the fixture, odds, and h2h context.',
    'Prefer over/under, both teams to score, double chance, draw no bet, corners, or throw-ins when the data supports them.',
    'Avoid straight win, away win, home win, or draw selections unless the evidence is strong.',
    'confidence must be a decimal from 0 to 1.',
    'confidence_label must be either high or medium.',
    'If the evidence is weak, still return valid JSON and lower confidence rather than explaining uncertainty.',
    '',
    `FIXTURE: ${JSON.stringify(fixture)}`,
    `ODDS: ${JSON.stringify(oddsRows)}`,
    `H2H_HISTORY: ${JSON.stringify(h2hRows)}`,
    '',
    'Return only the JSON object, with no surrounding text.',
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

function selectionMinimumConfidence(selection) {
  const value = String(selection || '').trim().toLowerCase();
  if (
    /\bunder\s*1\.5\b/.test(value) ||
    /\bunder\s*2\.5\b/.test(value) ||
    /\bover\s*3\.5\b/.test(value)
  ) {
    return 0.9;
  }

  return 0.85;
}

function shouldKeepSelection(selection, confidence) {
  const value = String(selection || '').trim();
  if (!value) {
    return false;
  }

  return Number.isFinite(confidence) && confidence >= selectionMinimumConfidence(value);
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
    'You are a JSON generator for football predictions.',
    'Return exactly one valid JSON object and nothing else.',
    'Use double quotes only.',
    'Never output markdown, code fences, comments, or multiple objects.',
    'The object must contain predicted_winner, confidence, confidence_label, and picks.',
    'picks must be an array with exactly one item.',
    'The single pick must contain selection and confidence only.',
    'Use only the fixture, odds, and h2h context provided by the user message.',
    'Prefer safer non-straight-win markets when possible.',
    'If the safest choice is unclear, still return valid JSON with a conservative selection and lower confidence.',
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
