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
    'Use the fixture and odds context to produce a single JSON object. Optional h2h history may be provided, but it is not required.',
    'MANDATORY JSON structure: {"predicted_winner": "string", "confidence": number, "confidence_label": "string", "picks": [{"selection": "string", "confidence": number, "reason": "string"}]}',
    'The picks array must contain exactly 1 entry.',
    'That single pick must include only selection and confidence.',
    'Do not generate any reason, explanation text, commentary, or analysis for any prediction.',
    'Set reason to an empty string for every pick.',
    'Focus on low-odds markets such as over, under, gg/btts, corners, double chance 12, and throw-ins if the data exists.',
    'Target at least 10 predictions with confidence from 0.87 to 1.00 and at least 5 additional predictions with confidence from 0.85 to 0.869 when enough fixtures exist.',
    'Do not lower confidence just to hit a quota if the fixture does not support it.',
    'If Over 3.5 or Under 2.5 is not at least 0.90 confident, do not pick it.',
    'If Under 1.5, Under 2.5, or Over 3.5 is not at least 0.90 confident, choose another safer market instead of forcing it.',
    'When choosing an Over/Under goals market, use the available match context and odds. Prefer the safest line that fits the overall signals. Never default to a fixed line - always derive it from the data you have.',
    'Do not choose a straight win or draw selection unless you are at least 0.90 confident.',
    'If confidence is below 0.90, avoid home win, away win, draw, or team-name winner picks and choose a non-win market instead.',
    'If throw-in data is not available, skip it.',
    'If the evidence is weak, lower confidence below 0.85.',
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
    '  "confidence": 0.91,',
    '  "confidence_label": "high",',
    '  "picks": [',
    '    {',
    '      "selection": "Over 3.5",',
    '      "confidence": 0.91,',
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
    'Return only valid JSON.',
    'Include predicted_winner, confidence, confidence_label, and picks.',
    'picks must be an array with exactly 1 item.',
    'The single pick must include selection, confidence, and reason.',
    'If confidence is below 0.85, reason must be an empty string.',
    'Never use phrases about limited data, small samples, missing history, insufficient evidence, or not enough matches as reason text for a 0.85+ confidence pick.',
    'Do not add markdown, explanation text, or code fences.',
    'Do not add extra explanation outside the single short reason field.',
    'Use fixture context and odds only.',
    'If H2H data is empty, rely on whatever context is already supplied.',
    'If no H2H data exists at all, do not invent H2H and stay conservative.',
    'Prefer non-straight-win selections such as Over/Under, Both Teams To Score, Double Chance, Draw, or No Bet.',
    'When choosing Over/Under goals, pick the line that fits the h2h average goals: use Over 3.5 if average is near 4, Over 2.5 if near 3, Over 1.5 if near 2. For Under markets, use Under 1.5 if average is below 1, Under 2.5 if average is near 2, Under 3.5 if near 3. Never default to a fixed line - always derive it from the data.',
    "Don't use straight-win selections unless confidence is 0.99 or higher.",
    "Don't waste credits on straight-win picks when a safer market is available.",
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

module.exports = {
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
