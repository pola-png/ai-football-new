import { ID } from 'node-appwrite';

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

/**
 * Saves a prediction to the Appwrite database.
 * Maps modular prediction outputs to the Appwrite schema.
 * @param {object} params - Saving parameters
 * @param {object} params.tablesdb - Appwrite TablesDB instance
 * @param {string} params.databaseId - Database ID
 * @param {string} params.predictionsTable - Predictions table ID
 * @param {object} params.fixture - Raw fixture document
 * @param {object} params.chosenPrediction - Chosen prediction from selector
 * @param {string} params.reason - Human-readable reason string
 * @param {string} [params.releaseStatus] - 'draft' or 'published'
 * @param {string} [params.publishedAt] - ISO datetime if published
 * @returns {Promise<object>} Status of the save operation
 */
export async function savePrediction({
  tablesdb,
  databaseId,
  predictionsTable,
  fixture,
  chosenPrediction,
  reason,
  releaseStatus = 'draft',
  publishedAt = null,
}) {
  const fixtureApiId = String(fixture?.api_fixture_id || '').trim();
  if (!fixtureApiId) {
    throw new Error('Cannot save prediction: missing api_fixture_id in fixture.');
  }

  const predictionId = `prediction_${fixtureApiId}`;
  const now = isoNow();

  // Determine predicted winner label
  let predictedWinner = 'TBD';
  if (chosenPrediction.market === 'Winner') {
    if (chosenPrediction.selection === 'Home Win') {
      predictedWinner = fixture?.home_team_name || 'Home';
    } else if (chosenPrediction.selection === 'Away Win') {
      predictedWinner = fixture?.away_team_name || 'Away';
    } else if (chosenPrediction.selection === 'Draw') {
      predictedWinner = 'Draw';
    }
  }

  const confidenceLabel = chosenPrediction.confidence >= 0.85 ? 'high' : 'medium';

  const data = {
    fixture_api_id: fixtureApiId,
    model_name: 'rule-engine-v1',
    prediction_text: reason,
    predicted_winner: predictedWinner,
    confidence: chosenPrediction.confidence,
    confidence_label: confidenceLabel,
    market: chosenPrediction.market,
    home_team_name: fixture?.home_team_name || null,
    away_team_name: fixture?.away_team_name || null,
    home_team_logo_url: fixture?.home_team_logo_url || null,
    away_team_logo_url: fixture?.away_team_logo_url || null,
    kickoff_at: fixture?.kickoff_at || null,
    match_status_short: fixture?.status_short || 'NS',
    match_status_long: fixture?.status_long || 'Not Started',
    primary_market: chosenPrediction.market,
    primary_selection: chosenPrediction.selection,
    primary_confidence: chosenPrediction.confidence,
    primary_reason: reason,
    secondary_market: null,
    secondary_selection: null,
    secondary_confidence: null,
    secondary_reason: null,
    tertiary_market: null,
    tertiary_selection: null,
    tertiary_confidence: null,
    tertiary_reason: null,
    release_status: releaseStatus,
    release_at: now,
    generated_at: now,
    published_at: publishedAt,
    notification_sent: false,
    notification_sent_at: null,
    created_at: now,
    updated_at: now,
  };

  await upsertRow(tablesdb, databaseId, predictionsTable, predictionId, data);

  return {
    saved: true,
    predictionId,
    fixtureApiId,
    primaryConfidence: chosenPrediction.confidence,
    primarySelection: chosenPrediction.selection,
    primaryReason: reason,
  };
}
