const { Account, Client, Query, TablesDB, Users } = require('node-appwrite');

function logStep(step, details = {}) {
  console.log(JSON.stringify({
    level: 'info',
    step,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}

function logError(step, error, details = {}) {
  console.error(JSON.stringify({
    level: 'error',
    step,
    timestamp: new Date().toISOString(),
    message: error?.message || String(error),
    stack: error?.stack,
    ...details,
  }));
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildAdminClient() {
  const client = new Client();
  client
    .setEndpoint(required('APPWRITE_FUNCTION_ENDPOINT'))
    .setProject(required('APPWRITE_FUNCTION_PROJECT_ID'))
    .setKey(required('APPWRITE_FUNCTION_API_KEY'));
  return client;
}

function buildSessionClient() {
  const client = new Client();
  client
    .setEndpoint(required('APPWRITE_FUNCTION_ENDPOINT'))
    .setProject(required('APPWRITE_FUNCTION_PROJECT_ID'));

  const jwt = String(process.env.APPWRITE_FUNCTION_JWT || '').trim();
  if (jwt) {
    client.setJWT(jwt);
  }

  return client;
}

function readPayload() {
  return (
    process.env.APPWRITE_FUNCTION_DATA ||
    process.env.APPWRITE_FUNCTION_BODY ||
    process.env.APPWRITE_FUNCTION_PAYLOAD ||
    process.env.APPWRITE_FUNCTION_EVENT_DATA ||
    ''
  );
}

function parsePayload() {
  const rawPayload = readPayload();
  if (!rawPayload) {
    return {};
  }

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    logError('payload.parse_failed', error, {
      rawPayloadPreview: String(rawPayload).slice(0, 500),
    });
    return {};
  }
}

function normalizeTableId(envName, fallback) {
  return String(process.env[envName] || fallback).trim();
}

async function deleteRowsByUserId(tablesdb, databaseId, tableId, userId) {
  let deleted = 0;

  while (true) {
    const result = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [
        Query.equal('user_id', userId),
        Query.limit(100),
      ],
      total: false,
    });

    const rows = result.rows || [];
    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      try {
        await tablesdb.deleteRow({
          databaseId,
          tableId,
          rowId: row.$id,
        });
        deleted += 1;
      } catch (error) {
        if (String(error?.code) !== '404' && !String(error?.message || '').includes('Row not found')) {
          throw error;
        }
      }
    }
  }

  return deleted;
}

async function deleteRowIfExists(tablesdb, databaseId, tableId, rowId) {
  try {
    await tablesdb.deleteRow({
      databaseId,
      tableId,
      rowId,
    });
    return true;
  } catch (error) {
    if (String(error?.code) !== '404' && !String(error?.message || '').includes('Row not found')) {
      throw error;
    }
    return false;
  }
}

async function resolveCurrentUserId() {
  const directUserId = String(process.env.APPWRITE_FUNCTION_USER_ID || '').trim();
  if (directUserId) {
    return directUserId;
  }

  const jwt = String(process.env.APPWRITE_FUNCTION_JWT || '').trim();
  if (!jwt) {
    throw new Error('Missing authenticated user context.');
  }

  const client = buildSessionClient();
  const account = new Account(client);
  const user = await account.get();
  return user.$id;
}

async function main() {
  const startedAt = new Date().toISOString();
  const payload = parsePayload();

  logStep('function.start', {
    functionId: process.env.APPWRITE_FUNCTION_ID || null,
    deploymentId: process.env.APPWRITE_FUNCTION_DEPLOYMENT || null,
    hasUserId: Boolean(process.env.APPWRITE_FUNCTION_USER_ID),
    hasJwt: Boolean(process.env.APPWRITE_FUNCTION_JWT),
    confirmation: payload.confirmation || null,
  });

  if (String(payload.confirmation || '').trim().toUpperCase() !== 'DELETE') {
    throw new Error('Missing delete confirmation.');
  }

  const userId = await resolveCurrentUserId();
  const databaseId = required('APPWRITE_DATABASE_ID');
  const tableUserProfiles = normalizeTableId('APPWRITE_TABLE_USER_PROFILES', 'user_profiles');
  const tableComments = normalizeTableId('APPWRITE_TABLE_PREDICTION_COMMENTS', 'prediction_comments');
  const tableSelections = normalizeTableId('APPWRITE_TABLE_PREDICTION_SELECTIONS', 'prediction_selections');
  const tableCheckins = normalizeTableId('APPWRITE_TABLE_DAILY_CHECKINS', 'daily_checkins');
  const tableChallengeEntries = normalizeTableId('APPWRITE_TABLE_CHALLENGE_ENTRIES', 'challenge_entries');

  const tablesdb = new TablesDB(buildAdminClient());
  const users = new Users(buildAdminClient());

  const deleted = {
    user_profile: false,
    prediction_comments: 0,
    prediction_selections: 0,
    daily_checkins: 0,
    challenge_entries: 0,
    auth_user: false,
  };

  try {
    logStep('deletion.rows.start', { userId });

    deleted.prediction_comments = await deleteRowsByUserId(tablesdb, databaseId, tableComments, userId);
    deleted.prediction_selections = await deleteRowsByUserId(tablesdb, databaseId, tableSelections, userId);
    deleted.daily_checkins = await deleteRowsByUserId(tablesdb, databaseId, tableCheckins, userId);
    deleted.challenge_entries = await deleteRowsByUserId(tablesdb, databaseId, tableChallengeEntries, userId);
    deleted.user_profile = await deleteRowIfExists(tablesdb, databaseId, tableUserProfiles, userId);

    logStep('deletion.rows.success', {
      userId,
      deleted,
    });

    await users.delete(userId);
    deleted.auth_user = true;

    logStep('deletion.auth.success', {
      userId,
    });

    return {
      ok: true,
      user_id: userId,
      deleted,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
  } catch (error) {
    logError('function.failed', error, {
      userId,
      deleted,
    });
    throw error;
  }
}

main().then(
  (result) => {
    logStep('function.completed', result);
  },
  (error) => {
    logError('function.failed', error);
    process.exitCode = 1;
  },
);
