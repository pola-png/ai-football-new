import { Query } from 'node-appwrite';
import { DEFAULT_MARKET_ACCURACIES } from '../weighting/marketWeighting.js';

function isoNow() {
  return new Date().toISOString();
}

/**
 * Resolves whether a prediction was correct based on final scores.
 * @param {string} market - Prediction market (Winner, BTTS, Over/Under, Draw, Double Chance, etc.)
 * @param {string} selection - Selection name (Yes, No, Home Win, Over 2.5, 1X, etc.)
 * @param {number} homeScore - Actual home team score
 * @param {number} awayScore - Actual away team score
 * @returns {boolean|null} True if correct, false if incorrect, null if cannot resolve
 */
export function evaluatePrediction(market, selection, homeScore, awayScore) {
  if (homeScore === null || awayScore === null || Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
    return null;
  }

  const hs = Number(homeScore);
  const as = Number(awayScore);
  const totalGoals = hs + as;

  switch (market) {
    case 'Winner':
      if (selection === 'Home Win') return hs > as;
      if (selection === 'Away Win') return as > hs;
      if (selection === 'Draw') return hs === as;
      return null;

    case 'Draw':
      if (selection === 'Yes') return hs === as;
      if (selection === 'No') return hs !== as;
      return null;

    case 'BTTS':
      if (selection === 'Yes') return hs > 0 && as > 0;
      if (selection === 'No') return hs === 0 || as === 0;
      return null;

    case 'Over/Under':
      if (selection === 'Over 1.5') return totalGoals > 1.5;
      if (selection === 'Over 2.5') return totalGoals > 2.5;
      if (selection === 'Under 2.5') return totalGoals < 2.5;
      if (selection === 'Over 3.5') return totalGoals > 3.5;
      if (selection === 'Under 3.5') return totalGoals < 3.5;
      return null;

    case 'Double Chance':
      if (selection === '1X') return hs >= as;
      if (selection === 'X2') return as >= hs;
      if (selection === '12') return hs !== as;
      return null;

    case 'Corners':
      // Since corners are usually not tracked in final score, fallback
      return null;

    case 'Cards':
      // Since cards are usually not tracked in final score, fallback
      return null;

    default:
      return null;
  }
}

/**
 * Loads the current market accuracies from the Appwrite sync_runs table.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} syncRunsTable - Sync runs table ID
 * @returns {Promise<object>} Map of market name to accuracy (0.0 to 1.0)
 */
export async function loadMarketAccuracies(tablesdb, databaseId, syncRunsTable) {
  try {
    const result = await tablesdb.listRows({
      databaseId,
      tableId: syncRunsTable,
      queries: [
        Query.equal('job_name', 'market-accuracies'),
        Query.limit(1),
      ],
      total: false,
    });

    const row = result.rows[0];
    if (row && row.message) {
      const parsed = JSON.parse(row.message);
      if (parsed && typeof parsed === 'object') {
        const accuracies = {};
        for (const [market, data] of Object.entries(parsed)) {
          accuracies[market] = data.accuracy;
        }
        return {
          accuracies,
          registry: parsed,
          rowId: row.$id,
        };
      }
    }
  } catch (error) {
    console.warn('Could not load market accuracies from database:', error.message);
  }

  // If not found, build default registry state
  const registry = {};
  for (const [market, defaultAcc] of Object.entries(DEFAULT_MARKET_ACCURACIES)) {
    registry[market] = {
      hits: Math.round(defaultAcc * 100),
      total: 100,
      accuracy: defaultAcc,
    };
  }

  return {
    accuracies: DEFAULT_MARKET_ACCURACIES,
    registry,
    rowId: null,
  };
}

/**
 * Updates a market's accuracy registry in the database based on a resolution.
 * @param {object} tablesdb - Appwrite TablesDB instance
 * @param {string} databaseId - Database ID
 * @param {string} syncRunsTable - Sync runs table ID
 * @param {string} market - Prediction market
 * @param {boolean} isCorrect - Whether prediction was correct
 * @returns {Promise<object>} The updated accuracy registry
 */
export async function updateMarketAccuracy(tablesdb, databaseId, syncRunsTable, market, isCorrect) {
  const { registry, rowId } = await loadMarketAccuracies(tablesdb, databaseId, syncRunsTable);

  if (!registry[market]) {
    registry[market] = { hits: 0, total: 0, accuracy: 0.70 };
  }

  const record = registry[market];
  record.total += 1;
  if (isCorrect) {
    record.hits += 1;
  }
  record.accuracy = Number((record.hits / record.total).toFixed(4));

  const data = {
    job_name: 'market-accuracies',
    status: 'success',
    message: JSON.stringify(registry),
    started_at: isoNow(),
    finished_at: isoNow(),
    updated_at: isoNow(),
  };

  try {
    if (rowId) {
      await tablesdb.updateRow({
        databaseId,
        tableId: syncRunsTable,
        rowId,
        data,
      });
    } else {
      data.created_at = isoNow();
      await tablesdb.createRow({
        databaseId,
        tableId: syncRunsTable,
        rowId: 'market_accuracies_doc',
        data,
      });
    }
  } catch (error) {
    console.error('Failed to save updated market accuracies to DB:', error);
  }

  return registry;
}
