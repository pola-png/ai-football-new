import { runPredictionEngine } from '../src/index.js';
import { evaluatePrediction } from '../src/learning/updateAccuracy.js';

/**
 * MockTablesDB — intercepts Appwrite listRows queries and applies
 * basic equality filtering so that loadTeamStats, loadOdds, loadH2H,
 * and loadStandings all receive the correct subset of rows.
 */
class MockTablesDB {
  constructor(mockData = {}) {
    this.mockData = mockData; // tableId -> Array<row>
  }

  async listRows({ tableId, queries }) {
    const allRows = this.mockData[tableId] || [];

    // Parse Query.equal() objects — node-appwrite serialises them as
    // JSON strings like: {"method":"equal","attribute":"team_api_id","values":["test123"]}
    const eqFilters = [];
    for (const q of queries || []) {
      try {
        const parsed = typeof q === 'string' ? JSON.parse(q) : q;
        if (parsed && parsed.method === 'equal' && parsed.attribute && Array.isArray(parsed.values)) {
          eqFilters.push({ field: parsed.attribute, values: parsed.values.map(String) });
        }
      } catch {
        // Not a JSON query (e.g. orderAsc, limit) — skip
      }
    }

    // Apply each equality filter sequentially
    let filtered = allRows;
    for (const { field, values } of eqFilters) {
      filtered = filtered.filter(row => values.includes(String(row[field] ?? '')));
    }

    return { rows: filtered };
  }
}

// ── Mock Datasets ──────────────────────────────────────────────────

const MOCK_FIXTURES = {
  mancity_arsenal: {
    api_fixture_id: 'mc_ars_101',
    home_team_api_id: 'mc_team',
    away_team_api_id: 'ars_team',
    home_team_name: 'Manchester City',
    away_team_name: 'Arsenal',
    league_api_id: 'pl_league',
    season: '2025',
    kickoff_at: '2026-07-02T19:00:00Z',
    status_short: 'NS',
  },
  realmadrid_getafe: {
    api_fixture_id: 'rm_get_102',
    home_team_api_id: 'rm_team',
    away_team_api_id: 'get_team',
    home_team_name: 'Real Madrid',
    away_team_name: 'Getafe',
    league_api_id: 'la_league',
    season: '2025',
    kickoff_at: '2026-07-03T20:00:00Z',
    status_short: 'NS',
  },
  lowdata_fixture: {
    api_fixture_id: 'low_data_201',
    home_team_api_id: 'teamA',
    away_team_api_id: 'teamB',
    home_team_name: 'FC Unknown Home',
    away_team_name: 'FC Unknown Away',
    league_api_id: 'unknown_league',
    season: '2025',
    kickoff_at: '2026-07-04T15:00:00Z',
    status_short: 'NS',
  },
};

const MOCK_H2H = {
  mc_ars_101: [
    { current_fixture_api_id: 'mc_ars_101', home_team_api_id: 'mc_team', away_team_api_id: 'ars_team', home_score: '2', away_score: '2', winner: 'draw', kickoff_at: '2025-09-22T16:30:00Z', status_short: 'FT' },
    { current_fixture_api_id: 'mc_ars_101', home_team_api_id: 'ars_team', away_team_api_id: 'mc_team', home_score: '1', away_score: '0', winner: 'home', kickoff_at: '2024-10-08T15:30:00Z', status_short: 'FT' },
    { current_fixture_api_id: 'mc_ars_101', home_team_api_id: 'mc_team', away_team_api_id: 'ars_team', home_score: '4', away_score: '1', winner: 'home', kickoff_at: '2023-04-26T19:00:00Z', status_short: 'FT' },
    { current_fixture_api_id: 'mc_ars_101', home_team_api_id: 'ars_team', away_team_api_id: 'mc_team', home_score: '1', away_score: '3', winner: 'away', kickoff_at: '2023-02-15T19:30:00Z', status_short: 'FT' },
  ],
  rm_get_102: [
    { current_fixture_api_id: 'rm_get_102', home_team_api_id: 'rm_team', away_team_api_id: 'get_team', home_score: '2', away_score: '1', winner: 'home', kickoff_at: '2025-05-12T19:00:00Z', status_short: 'FT' },
    { current_fixture_api_id: 'rm_get_102', home_team_api_id: 'get_team', away_team_api_id: 'rm_team', home_score: '0', away_score: '2', winner: 'away', kickoff_at: '2024-12-02T19:00:00Z', status_short: 'FT' },
    { current_fixture_api_id: 'rm_get_102', home_team_api_id: 'rm_team', away_team_api_id: 'get_team', home_score: '4', away_score: '0', winner: 'home', kickoff_at: '2024-04-09T19:00:00Z', status_short: 'FT' },
  ],
};

const MOCK_ODDS = {
  mc_ars_101: [
    { fixture_api_id: 'mc_ars_101', market_name: 'Match Winner', selection_name: 'Home', odd_value: 2.10 },
    { fixture_api_id: 'mc_ars_101', market_name: 'Match Winner', selection_name: 'Draw', odd_value: 3.40 },
    { fixture_api_id: 'mc_ars_101', market_name: 'Match Winner', selection_name: 'Away', odd_value: 3.20 },
    { fixture_api_id: 'mc_ars_101', market_name: 'Both Teams to Score', selection_name: 'Yes', odd_value: 1.55 },
    { fixture_api_id: 'mc_ars_101', market_name: 'Both Teams to Score', selection_name: 'No', odd_value: 2.30 },
    { fixture_api_id: 'mc_ars_101', market_name: 'Goals Over/Under', selection_name: 'Over 2.5', odd_value: 1.65, line_value: '2.5' },
    { fixture_api_id: 'mc_ars_101', market_name: 'Goals Over/Under', selection_name: 'Under 2.5', odd_value: 2.20, line_value: '2.5' },
  ],
  rm_get_102: [
    { fixture_api_id: 'rm_get_102', market_name: 'Match Winner', selection_name: 'Home', odd_value: 1.25 },
    { fixture_api_id: 'rm_get_102', market_name: 'Match Winner', selection_name: 'Draw', odd_value: 5.50 },
    { fixture_api_id: 'rm_get_102', market_name: 'Match Winner', selection_name: 'Away', odd_value: 11.00 },
    { fixture_api_id: 'rm_get_102', market_name: 'Both Teams to Score', selection_name: 'Yes', odd_value: 2.10 },
    { fixture_api_id: 'rm_get_102', market_name: 'Both Teams to Score', selection_name: 'No', odd_value: 1.65 },
    { fixture_api_id: 'rm_get_102', market_name: 'Goals Over/Under', selection_name: 'Over 2.5', odd_value: 1.70, line_value: '2.5' },
    { fixture_api_id: 'rm_get_102', market_name: 'Goals Over/Under', selection_name: 'Under 2.5', odd_value: 2.15, line_value: '2.5' },
  ],
};

const MOCK_STANDINGS = {
  pl_league: [
    { league_api_id: 'pl_league', season: '2025', rank: 1, team_api_id: 'mc_team', points: 84 },
    { league_api_id: 'pl_league', season: '2025', rank: 2, team_api_id: 'ars_team', points: 81 },
  ],
  la_league: [
    { league_api_id: 'la_league', season: '2025', rank: 1, team_api_id: 'rm_team', points: 88 },
    { league_api_id: 'la_league', season: '2025', rank: 15, team_api_id: 'get_team', points: 34 },
  ],
};

const MOCK_TEAM_STATS = {
  mc_team: { team_api_id: 'mc_team', league_api_id: 'pl_league', season: '2025', form: 'WWDWW', goals: { for: { average: { home: '2.4', total: '2.2' } }, against: { average: { home: '1.1', total: '1.0' } } } },
  ars_team: { team_api_id: 'ars_team', league_api_id: 'pl_league', season: '2025', form: 'WDWWW', goals: { for: { average: { away: '2.1', total: '1.9' } }, against: { average: { away: '0.9', total: '0.8' } } } },
  rm_team: { team_api_id: 'rm_team', league_api_id: 'la_league', season: '2025', form: 'WWWWW', goals: { for: { average: { home: '2.8', total: '2.6' } }, against: { average: { home: '0.5', total: '0.6' } } } },
  get_team: { team_api_id: 'get_team', league_api_id: 'la_league', season: '2025', form: 'LLDLL', goals: { for: { average: { away: '0.8', total: '0.7' } }, against: { average: { away: '1.9', total: '1.7' } } } },
};

// ── Helpers ────────────────────────────────────────────────────────

function printFeatureSnapshot(features) {
  console.log('  Key Features:');
  console.log(`    homeFormScore=${features.homeFormScore}%  awayFormScore=${features.awayFormScore}%`);
  console.log(`    homeStrength=${features.homeStrength}  awayStrength=${features.awayStrength}  diff=${features.strengthDifference}`);
  console.log(`    avgGoalsScoredHome=${features.avgGoalsScoredHome}  avgGoalsScoredAway=${features.avgGoalsScoredAway}`);
  console.log(`    bttsRate=${features.bttsRate}  bttsRateH2H=${features.bttsRateH2H}`);
  console.log(`    over25Rate=${features.over25Rate}  over25RateH2H=${features.over25RateH2H}`);
  console.log(`    h2hMatchCount=${features.h2hMatchCount}  hasOdds=${features.hasOdds}  hasStandings=${features.hasStandings}`);
}

function printAllCandidates(candidates) {
  console.log('  All Market Candidates (sorted by weightedScore):');
  for (const c of candidates) {
    console.log(`    ${c.market.padEnd(15)} ${c.selection.padEnd(12)} raw=${c.rawScore}  wt=${c.weightedScore?.toFixed(1)}  conf=${c.confidence}`);
  }
}

let totalTests = 0;
let passedTests = 0;

function assert(label, condition) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
  }
}

// ── Test 1: Man City vs Arsenal (balanced top teams) ──────────────

async function testManCityVsArsenal() {
  console.log('\n═══ Test 1: Manchester City vs Arsenal ═══');

  const fixture = MOCK_FIXTURES.mancity_arsenal;
  const mockdb = new MockTablesDB({
    'fixture_odds': MOCK_ODDS.mc_ars_101,
    'fixture_h2h_history': MOCK_H2H.mc_ars_101,
    'standings': MOCK_STANDINGS.pl_league,
    'team_statistics': [MOCK_TEAM_STATS.mc_team, MOCK_TEAM_STATS.ars_team],
  });

  const result = await runPredictionEngine({
    tablesdb: mockdb,
    databaseId: 'test_db',
    tablesConfig: { oddsTable: 'fixture_odds', h2hTable: 'fixture_h2h_history', standingsTable: 'standings', teamStatsTable: 'team_statistics' },
    fixtureDoc: fixture,
  });

  printFeatureSnapshot(result.features);
  printAllCandidates(result.chosen.allCandidates);
  console.log(`  Winner: ${result.chosen.market} → ${result.chosen.selection}  (confidence ${result.chosen.confidence})`);
  console.log(`  Reason: ${result.reason}\n`);

  // With balanced H2H (2-2, 1-0, 4-1, 1-3) we expect a goals or safety market
  const acceptedMarkets = ['BTTS', 'Double Chance', 'Over/Under'];
  assert('Selected a goals/double-chance market', acceptedMarkets.includes(result.chosen.market));
  assert('Confidence is between 0.50 and 0.95', result.chosen.confidence >= 0.50 && result.chosen.confidence <= 0.95);
  assert('Reason is non-empty', result.reason.length > 20);
}

// ── Test 2: Real Madrid vs Getafe (dominant vs weak) ──────────────

async function testRealMadridVsGetafe() {
  console.log('\n═══ Test 2: Real Madrid vs Getafe ═══');

  const fixture = MOCK_FIXTURES.realmadrid_getafe;
  const mockdb = new MockTablesDB({
    'fixture_odds': MOCK_ODDS.rm_get_102,
    'fixture_h2h_history': MOCK_H2H.rm_get_102,
    'standings': MOCK_STANDINGS.la_league,
    'team_statistics': [MOCK_TEAM_STATS.rm_team, MOCK_TEAM_STATS.get_team],
  });

  const result = await runPredictionEngine({
    tablesdb: mockdb,
    databaseId: 'test_db',
    tablesConfig: { oddsTable: 'fixture_odds', h2hTable: 'fixture_h2h_history', standingsTable: 'standings', teamStatsTable: 'team_statistics' },
    fixtureDoc: fixture,
  });

  printFeatureSnapshot(result.features);
  printAllCandidates(result.chosen.allCandidates);
  console.log(`  Winner: ${result.chosen.market} → ${result.chosen.selection}  (confidence ${result.chosen.confidence})`);
  console.log(`  Reason: ${result.reason}\n`);

  // Heavy favourite: Home Win or 1X
  const isHomeWin = result.chosen.market === 'Winner' && result.chosen.selection === 'Home Win';
  const is1X = result.chosen.market === 'Double Chance' && result.chosen.selection === '1X';
  assert('Predicted Real Madrid to win or avoid defeat', isHomeWin || is1X);
  assert('Form scores reflect dominance gap', result.features.homeFormScore > result.features.awayFormScore);
}

// ── Test 3: Low data fixture (no stats, no standings, minimal H2H)

async function testLowDataFixture() {
  console.log('\n═══ Test 3: Low-Data Fixture (graceful degradation) ═══');

  const fixture = MOCK_FIXTURES.lowdata_fixture;
  const mockdb = new MockTablesDB({}); // totally empty — no odds, no h2h, no stats

  const result = await runPredictionEngine({
    tablesdb: mockdb,
    databaseId: 'test_db',
    tablesConfig: { oddsTable: 'fixture_odds', h2hTable: 'fixture_h2h_history', standingsTable: 'standings', teamStatsTable: 'team_statistics' },
    fixtureDoc: fixture,
  });

  printFeatureSnapshot(result.features);
  printAllCandidates(result.chosen.allCandidates);
  console.log(`  Winner: ${result.chosen.market} → ${result.chosen.selection}  (confidence ${result.chosen.confidence})`);
  console.log(`  Reason: ${result.reason}\n`);

  assert('Engine does not crash with zero data', true);
  assert('Some market is selected', result.chosen.market.length > 0);
  assert('Confidence is low due to missing data', result.chosen.confidence < 0.80);
}

// ── Test 4: Learning module — evaluatePrediction ──────────────────

function testEvaluatePrediction() {
  console.log('\n═══ Test 4: Learning Module (evaluatePrediction) ═══');

  // Winner
  assert('Home Win correct when 2-1',    evaluatePrediction('Winner', 'Home Win', 2, 1) === true);
  assert('Home Win wrong when 0-1',      evaluatePrediction('Winner', 'Home Win', 0, 1) === false);
  assert('Away Win correct when 0-3',    evaluatePrediction('Winner', 'Away Win', 0, 3) === true);
  assert('Draw correct when 1-1',        evaluatePrediction('Winner', 'Draw', 1, 1) === true);

  // BTTS
  assert('BTTS Yes correct when 2-1',    evaluatePrediction('BTTS', 'Yes', 2, 1) === true);
  assert('BTTS Yes wrong when 2-0',      evaluatePrediction('BTTS', 'Yes', 2, 0) === false);
  assert('BTTS No correct when 1-0',     evaluatePrediction('BTTS', 'No', 1, 0) === true);

  // Over/Under
  assert('Over 2.5 correct when 2-1',    evaluatePrediction('Over/Under', 'Over 2.5', 2, 1) === true);
  assert('Over 2.5 wrong when 1-0',      evaluatePrediction('Over/Under', 'Over 2.5', 1, 0) === false);
  assert('Under 2.5 correct when 1-1',   evaluatePrediction('Over/Under', 'Under 2.5', 1, 1) === true);
  assert('Over 1.5 correct when 1-1',    evaluatePrediction('Over/Under', 'Over 1.5', 1, 1) === true);

  // Double Chance
  assert('1X correct when 1-1',          evaluatePrediction('Double Chance', '1X', 1, 1) === true);
  assert('1X correct when 2-0',          evaluatePrediction('Double Chance', '1X', 2, 0) === true);
  assert('1X wrong when 0-2',            evaluatePrediction('Double Chance', '1X', 0, 2) === false);
  assert('12 correct when 3-1',          evaluatePrediction('Double Chance', '12', 3, 1) === true);
  assert('12 wrong when 0-0',            evaluatePrediction('Double Chance', '12', 0, 0) === false);

  // Null case
  assert('Null scores returns null',     evaluatePrediction('Winner', 'Home Win', null, null) === null);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     Prediction Engine — Offline Test Suite       ║');
  console.log('╚══════════════════════════════════════════════════╝');

  try {
    await testManCityVsArsenal();
    await testRealMadridVsGetafe();
    await testLowDataFixture();
    testEvaluatePrediction();

    console.log(`\n══════════════════════════════════════`);
    console.log(`  Results: ${passedTests}/${totalTests} passed`);
    if (passedTests === totalTests) {
      console.log('  All tests passed ✅');
    } else {
      console.log(`  ${totalTests - passedTests} test(s) failed ❌`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\nFATAL: Test execution crashed:', error);
    process.exit(1);
  }
}

main();
