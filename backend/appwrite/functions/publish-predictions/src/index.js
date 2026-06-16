const { Client, TablesDB, ID, Query, Messaging } = require('node-appwrite');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildClient() {
  const client = new Client();
  client
    .setEndpoint(required('APPWRITE_FUNCTION_ENDPOINT'))
    .setProject(required('APPWRITE_FUNCTION_PROJECT_ID'))
    .setKey(required('APPWRITE_FUNCTION_API_KEY'));
  return client;
}

function isoNow() {
  return new Date().toISOString();
}

async function createRun(tablesdb, databaseId, tableId, data) {
  return tablesdb.createRow({
    databaseId,
    tableId,
    rowId: ID.unique(),
    data,
  });
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

async function fetchAllRows(tablesdb, databaseId, tableId, baseQueries, pageSize = 100) {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await tablesdb.listRows({
      databaseId,
      tableId,
      queries: [...baseQueries, Query.limit(pageSize), Query.offset(offset)],
      total: false,
    });

    const pageRows = result.rows || [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function main() {
  const client = buildClient();
  const tablesdb = new TablesDB(client);
  const messaging = new Messaging(client);

  const databaseId = required('APPWRITE_DATABASE_ID');
  const predictionsTable = required('APPWRITE_TABLE_PREDICTIONS');
  const syncRunsTable = required('APPWRITE_TABLE_SYNC_RUNS');
  const topicId = required('APPWRITE_TOPIC_PREDICTIONS');

  const startedAt = isoNow();
  let published = 0;

  try {
    const now = isoNow();
    const rows = await fetchAllRows(tablesdb, databaseId, predictionsTable, [
      Query.equal('release_status', 'draft'),
      Query.lessThanEqual('release_at', now),
      Query.orderAsc('release_at'),
    ]);

    for (const row of rows) {
      const publishedAt = isoNow();
      try {
        const primarySelection = typeof row.primary_selection === 'string' ? row.primary_selection.trim() : '';
        const primaryReason = typeof row.primary_reason === 'string' ? row.primary_reason.trim() : '';
        if (!primarySelection || !primaryReason) {
          console.error(
            JSON.stringify({
              job: 'publish-predictions',
              fixture_api_id: row.fixture_api_id,
              prediction_id: row.$id,
              message: 'Skipping publish without a primary pick.',
            }),
          );
          continue;
        }

        await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
          release_status: 'published',
          published_at: publishedAt,
          updated_at: publishedAt,
        });

        await messaging.createPush({
          messageId: ID.unique(),
          title: 'New prediction is live',
          body: 'Your football prediction is ready.',
          topics: [topicId],
          data: {
            fixture_api_id: String(row.fixture_api_id),
            prediction_id: row.$id,
            release_status: 'published',
          },
          draft: false,
        });

        await upsertRow(tablesdb, databaseId, predictionsTable, row.$id, {
          release_status: 'published',
          published_at: publishedAt,
          notification_sent: true,
          notification_sent_at: publishedAt,
          updated_at: publishedAt,
        });

        published += 1;
      } catch (error) {
        console.error(
          JSON.stringify({
            job: 'publish-predictions',
            fixture_api_id: row.fixture_api_id,
            prediction_id: row.$id,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'publish-predictions',
      status: 'success',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: rows.length,
      items_saved: published,
      message: `Published ${published} predictions and sent notifications.`,
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    return {
      ok: true,
      items_seen: rows.length,
      items_saved: published,
    };
  } catch (error) {
    await createRun(tablesdb, databaseId, syncRunsTable, {
      job_name: 'publish-predictions',
      status: 'failed',
      started_at: startedAt,
      finished_at: isoNow(),
      items_seen: published,
      items_saved: published,
      message: error instanceof Error ? error.message : String(error),
      created_at: isoNow(),
      updated_at: isoNow(),
    });

    throw error;
  }
}

main().then(
  (result) => {
    console.log(JSON.stringify(result));
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
