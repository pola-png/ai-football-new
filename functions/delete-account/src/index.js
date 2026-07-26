import { Account, Client, Query, TablesDB, Users } from '../../tablesdb.js';

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



export default async function main(userId, payloadInput = {}) {
  const startedAt = new Date().toISOString();
  
  let payload = {};
  if (typeof payloadInput === 'string') {
    try {
      payload = JSON.parse(payloadInput);
    } catch (e) {
      payload = {};
    }
  } else {
    payload = payloadInput || {};
  }

  logStep('function.start', {
    userId,
    confirmation: payload?.confirmation || null,
  });

  if (String(payload?.confirmation || '').trim().toUpperCase() !== 'DELETE') {
    throw new Error('Missing delete confirmation.');
  }
  const databaseId = required('APPWRITE_DATABASE_ID');
  const tableUserProfiles = normalizeTableId('APPWRITE_TABLE_USER_PROFILES', 'user_profiles');
  const tableComments = normalizeTableId('APPWRITE_TABLE_PREDICTION_COMMENTS', 'prediction_comments');
  const tableSelections = normalizeTableId('APPWRITE_TABLE_PREDICTION_SELECTIONS', 'prediction_selections');
  const tableChatMessages = normalizeTableId('APPWRITE_TABLE_CHAT_MESSAGES', 'chat_messages');
  const tableChatLikes = normalizeTableId('APPWRITE_TABLE_CHAT_MESSAGE_LIKES', 'chat_message_likes');
  const tableCheckins = normalizeTableId('APPWRITE_TABLE_DAILY_CHECKINS', 'daily_checkins');
  const tableChallengeEntries = normalizeTableId('APPWRITE_TABLE_CHALLENGE_ENTRIES', 'challenge_entries');

  const tablesdb = new TablesDB(buildAdminClient());
  const users = new Users(buildAdminClient());

  const deleted = {
    user_profile: false,
    prediction_comments: 0,
    prediction_selections: 0,
    chat_messages: 0,
    chat_message_likes: 0,
    daily_checkins: 0,
    challenge_entries: 0,
    auth_user: false,
  };

  try {
    logStep('deletion.rows.start', { userId });

    deleted.prediction_comments = await deleteRowsByUserId(tablesdb, databaseId, tableComments, userId);
    deleted.prediction_selections = await deleteRowsByUserId(tablesdb, databaseId, tableSelections, userId);
    deleted.chat_messages = await deleteRowsByUserId(tablesdb, databaseId, tableChatMessages, userId);
    deleted.chat_message_likes = await deleteRowsByUserId(tablesdb, databaseId, tableChatLikes, userId);
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


