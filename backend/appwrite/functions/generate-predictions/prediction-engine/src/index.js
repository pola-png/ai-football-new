import { loadOdds } from './loaders/loadOdds.js';
import { loadH2H } from './loaders/loadH2H.js';
import { loadStandings } from './loaders/loadStandings.js';
import { loadTeamStats } from './loaders/loadTeamStats.js';

import { extractGoalsFeatures } from './features/goals.js';
import { extractFormFeatures } from './features/form.js';
import { extractH2HFeatures } from './features/h2h.js';
import { extractOddsFeatures } from './features/odds.js';
import { extractStandingsFeatures } from './features/standings.js';
import { calculateStrengthFeatures } from './features/strength.js';

import { predictWinner } from './engines/winner.js';
import { predictBTTS } from './engines/btts.js';
import { predictOverUnder } from './engines/overUnder.js';
import { predictDraw } from './engines/draw.js';
import { predictDoubleChance } from './engines/doubleChance.js';
import { predictCorners } from './engines/corners.js';
import { predictCards } from './engines/cards.js';

import { calculateConfidence } from './confidence/confidence.js';
import { applyMarketWeights } from './weighting/marketWeighting.js';
import { chooseBestPrediction } from './selector/chooseBestPrediction.js';
import { buildReason } from './reasons/buildReason.js';

/**
 * Executes the entire prediction pipeline for a single fixture.
 * 
 * @param {object} params - Pipeline parameters
 * @param {object} params.tablesdb - Appwrite TablesDB instance
 * @param {string} params.databaseId - Database ID
 * @param {object} params.tablesConfig - Mapping of table keys to table names/IDs
 * @param {object} params.fixtureDoc - Fixture document to predict for
 * @param {object} [params.customAccuracies] - Custom historical market accuracy weights
 * @returns {Promise<object>} The chosen prediction, reason, confidence, and features
 */
export async function runPredictionEngine({
  tablesdb,
  databaseId,
  tablesConfig,
  fixtureDoc,
  customAccuracies = null,
}) {
  const fixtureApiId = String(fixtureDoc.api_fixture_id || '').trim();
  const homeTeamId = String(fixtureDoc.home_team_api_id || '').trim();
  const awayTeamId = String(fixtureDoc.away_team_api_id || '').trim();
  const leagueApiId = String(fixtureDoc.league_api_id || '').trim();
  const season = String(fixtureDoc.season || '').trim();

  // 1. Data Loading Phase
  const [oddsRows, h2hRows, standingsList, homeTeamStats, awayTeamStats] = await Promise.all([
    loadOdds(tablesdb, databaseId, tablesConfig.oddsTable, fixtureApiId, fixtureDoc),
    loadH2H(tablesdb, databaseId, tablesConfig.h2hTable, fixtureDoc),
    loadStandings(tablesdb, databaseId, tablesConfig.standingsTable, leagueApiId, season),
    loadTeamStats(tablesdb, databaseId, tablesConfig.teamStatsTable, homeTeamId, leagueApiId, season),
    loadTeamStats(tablesdb, databaseId, tablesConfig.teamStatsTable, awayTeamId, leagueApiId, season),
  ]);

  // 2. Feature Extraction Phase
  const goalsFeatures = extractGoalsFeatures(h2hRows, homeTeamStats, awayTeamStats, homeTeamId, awayTeamId);
  const formFeatures = extractFormFeatures(h2hRows, homeTeamStats, awayTeamStats, homeTeamId, awayTeamId);
  const h2hFeatures = extractH2HFeatures(h2hRows, homeTeamId, awayTeamId);
  const oddsFeatures = extractOddsFeatures(oddsRows);
  const standingsFeatures = extractStandingsFeatures(standingsList, homeTeamId, awayTeamId);
  const strengthFeatures = calculateStrengthFeatures(h2hRows, standingsFeatures, homeTeamId, awayTeamId);

  // Combine features into a single metrics context
  const features = {
    ...goalsFeatures,
    ...formFeatures,
    ...h2hFeatures,
    ...oddsFeatures,
    ...standingsFeatures,
    ...strengthFeatures,
  };

  // 3. Engine Scoring Phase
  const candidates = [
    predictWinner(features),
    predictBTTS(features),
    predictOverUnder(features),
    predictDraw(features),
    predictDoubleChance(features),
    predictCorners(features),
    predictCards(features),
  ];

  // 4. Confidence Evaluation Phase
  const candidatesWithConfidence = candidates.map(candidate => {
    const refinedConfidence = calculateConfidence(candidate, features);
    return {
      ...candidate,
      confidence: refinedConfidence,
    };
  });

  // 5. Market Weighting Phase
  const weightedCandidates = applyMarketWeights(candidatesWithConfidence, customAccuracies);

  // 6. Selection Phase
  const chosenResult = chooseBestPrediction(weightedCandidates, features);

  // 7. Reasoning Generation Phase
  const humanReason = buildReason(chosenResult, features, fixtureDoc);

  return {
    chosen: chosenResult,
    reason: humanReason,
    features,
  };
}
