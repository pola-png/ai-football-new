console.log(JSON.stringify({
  level: 'info',
  step: 'bootstrap',
  timestamp: new Date().toISOString(),
  message: 'admin-send-notification booted',
}));

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

process.on('uncaughtException', (error) => {
  logError('process.uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  logError('process.unhandledRejection', reason);
});

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
    logStep('payload.empty', { source: 'appwrite-env' });
    return {};
  }

  try {
    const parsed = JSON.parse(rawPayload);
    logStep('payload.parsed', {
      keys: Object.keys(parsed || {}),
      hasNotification: Boolean(parsed?.notification),
      hasData: Boolean(parsed?.data),
    });
    return parsed;
  } catch (error) {
    logError('payload.parse_failed', error, {
      rawPayloadPreview: String(rawPayload).slice(0, 500),
    });
    return {
      title: 'AI Football Prediction',
      body: String(rawPayload),
      data: {},
    };
  }
}

function loadSender() {
  logStep('module.load.start', {
    module: '../_shared/firebase-notifications.js',
  });

  const mod = require('../_shared/firebase-notifications.js');

  logStep('module.load.success', {
    module: '../_shared/firebase-notifications.js',
  });

  return mod.sendPredictionTopicNotification;
}

async function main() {
  logStep('function.start', {
    runtime: process.version,
    functionId: process.env.APPWRITE_FUNCTION_ID || null,
    deploymentId: process.env.APPWRITE_FUNCTION_DEPLOYMENT || null,
    hasFirebaseJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasProjectId: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID),
    hasClientEmail: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL),
    hasPrivateKey: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY),
    topicEnvPresent: Boolean(
      process.env.APPWRITE_TOPIC_PREDICTIONS ||
      process.env.APPWRITE_PREDICTION_TOPIC_ID,
    ),
  });

  let sendPredictionTopicNotification;
  try {
    sendPredictionTopicNotification = loadSender();
  } catch (error) {
    logError('module.load.failed', error, {
      module: '../_shared/firebase-notifications.js',
    });
    throw error;
  }

  const payload = parsePayload();
  const title = String(payload.title || payload.notification?.title || 'AI Football Prediction').trim();
  const body = String(payload.body || payload.notification?.body || 'A new notification is available.').trim();
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const topicId = String(
    payload.topicId ||
    process.env.APPWRITE_TOPIC_PREDICTIONS ||
    process.env.APPWRITE_PREDICTION_TOPIC_ID ||
    '',
  ).trim();

  logStep('notification.resolved', {
    title,
    bodyLength: body.length,
    topicId,
    dataKeys: Object.keys(data || {}),
  });

  if (!title || !body) {
    throw new Error('Notification title and body are required.');
  }
  if (!topicId) {
    throw new Error('Missing Firebase topic id.');
  }

  try {
    logStep('firebase.send.start', {
      topicId,
      title,
      dataPreview: data,
    });

    const messageId = await sendPredictionTopicNotification({
      topicId,
      title,
      body,
      data,
    });

    logStep('firebase.send.success', {
      topicId,
      messageId,
    });

    return {
      ok: true,
      message_id: messageId,
      topic_id: topicId,
    };
  } catch (error) {
    logError('firebase.send.failed', error, {
      topicId,
      title,
      dataKeys: Object.keys(data || {}),
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
    process.exit(1);
  },
);
