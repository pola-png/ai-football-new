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
  log = console.log,
}) {
  const fixtureApiId = String(fixtureDoc.api_fixture_id || '').trim();
  const homeTeamId = String(fixtureDoc.home_team_api_id || '').trim();
  const awayTeamId = String(fixtureDoc.away_team_api_id || '').trim();
  const leagueApiId = String(fixtureDoc.league_api_id || '').trim();
  const season = String(fixtureDoc.season || '').trim();

  log(`[Engine] Starting prediction for: ${fixtureDoc.home_team_name} vs ${fixtureDoc.away_team_name} (Fixture API ID: ${fixtureApiId})`);

  // 1. Data Loading Phase
  const [oddsRows, h2hRows, standingsList, homeTeamStats, awayTeamStats] = await Promise.all([
    loadOdds(tablesdb, databaseId, tablesConfig.oddsTable, fixtureApiId, fixtureDoc),
    loadH2H(tablesdb, databaseId, tablesConfig.h2hTable, fixtureDoc),
    loadStandings(tablesdb, databaseId, tablesConfig.standingsTable, leagueApiId, season),
    loadTeamStats(tablesdb, databaseId, tablesConfig.teamStatsTable, homeTeamId, leagueApiId, season),
    loadTeamStats(tablesdb, databaseId, tablesConfig.teamStatsTable, awayTeamId, leagueApiId, season),
  ]);

  log(`[Engine] Data loaded from Appwrite: ` +
      `oddsRows=${oddsRows.length}, ` +
      `h2hRows=${h2hRows.length}, ` +
      `standingsList=${standingsList.length}, ` +
      `homeTeamStats=${homeTeamStats ? 'Found (Appwrite Table)' : 'Calculated (Fallback)'}, ` +
      `awayTeamStats=${awayTeamStats ? 'Found (Appwrite Table)' : 'Calculated (Fallback)'}`);

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

  log(`[Engine] Extracted Features: ` +
      `homeFormScore=${features.homeFormScore}%, awayFormScore=${features.awayFormScore}%, ` +
      `homeStrength=${features.homeStrength}, awayStrength=${features.awayStrength}, ` +
      `avgGoalsScoredHome=${features.avgGoalsScoredHome}, avgGoalsScoredAway=${features.avgGoalsScoredAway}, ` +
      `bttsRate=${features.bttsRate}, over25Rate=${features.over25Rate}, ` +
      `hasOdds=${features.hasOdds}, hasStandings=${features.hasStandings}`);

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

  log('[Engine] Market Candidates scored:');
  for (const c of weightedCandidates) {
    log(`  - Market: ${c.market.padEnd(15)} Selection: ${c.selection.padEnd(12)} RawScore: ${c.rawScore.toString().padEnd(4)} WeightedScore: ${c.weightedScore?.toFixed(2)} Confidence: ${c.confidence?.toFixed(2)}`);
  }

  // 6. Selection Phase
  const chosenResult = chooseBestPrediction(weightedCandidates, features);

  // 7. Reasoning Generation Phase
  const humanReason = buildReason(chosenResult, features, fixtureDoc);

  log(`[Engine] Final Selection: ${chosenResult.market} -> ${chosenResult.selection} (Confidence: ${chosenResult.confidence})`);
  log(`[Engine] Reason: ${humanReason}`);

  return {
    chosen: chosenResult,
    reason: humanReason,
    features,
  };
}
