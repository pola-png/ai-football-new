import {
  normalizeConfidenceLabel,
  normalizePredictionReason,
  pickAt,
  shouldKeepSelection,
} from './ai.js';

function isoNow() {
  return new Date().toISOString();
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

async function savePredictionRow({
  tablesdb,
  databaseId,
  predictionsTable,
  fixture,
  aiResponse,
  parsed,
  startedAt,
  releaseStatus = 'draft',
  publishedAt = null,
}) {
  const fixtureApiId = String(fixture?.api_fixture_id || '').trim();
  const primaryPick = pickAt(parsed.picks, 0);
  const primaryConfidence =
    typeof primaryPick?.confidence === 'number'
      ? primaryPick.confidence
      : typeof parsed.confidence === 'number'
        ? parsed.confidence
        : 0.75;
  const fallbackSelection = 'Under 4.5 Goals';
  const primarySelection = shouldKeepSelection(primaryPick?.selection, primaryConfidence)
    ? primaryPick.selection.trim()
    : fallbackSelection;
  const primaryReason = normalizePredictionReason(primaryPick?.reason, primaryConfidence);
  const predictionId = `prediction_${fixtureApiId}`;

  if (!fixtureApiId) {
    return {
      saved: false,
      predictionId: null,
      fixtureApiId: null,
      primaryConfidence,
      primarySelection,
      primaryReason,
      predictedWinner: parsed.predicted_winner || 'TBD',
      confidenceLabel: normalizeConfidenceLabel(parsed.confidence_label, primaryConfidence),
    };
  }

  await upsertRow(tablesdb, databaseId, predictionsTable, predictionId, {
    fixture_api_id: fixtureApiId,
    model_name: aiResponse?.model || (process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    prediction_text: primaryReason || 'AI prediction generated',
    predicted_winner: parsed.predicted_winner || 'TBD',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    confidence_label: normalizeConfidenceLabel(parsed.confidence_label, primaryConfidence),
    home_team_name: fixture?.home_team_name || null,
    away_team_name: fixture?.away_team_name || null,
    home_team_logo_url: fixture?.home_team_logo_url || null,
    away_team_logo_url: fixture?.away_team_logo_url || null,
    kickoff_at: fixture?.kickoff_at || null,
    match_status_short: fixture?.status_short || null,
    match_status_long: fixture?.status_long || null,
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
    notification_sent: false,
    notification_sent_at: null,
    created_at: startedAt,
    updated_at: isoNow(),
  });

  return {
    saved: true,
    predictionId,
    fixtureApiId,
    primaryConfidence,
    primarySelection,
    primaryReason,
    predictedWinner: parsed.predicted_winner || 'TBD',
    confidenceLabel: normalizeConfidenceLabel(parsed.confidence_label, primaryConfidence),
  };
}

export {
  savePredictionRow,
};
