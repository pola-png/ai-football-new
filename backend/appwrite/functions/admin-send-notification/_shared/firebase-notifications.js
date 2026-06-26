const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

function logStep(step, details = {}) {
  console.log(JSON.stringify({
    level: 'info',
    component: 'firebase-notifications',
    step,
    timestamp: new Date().toISOString(),
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

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function buildServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return {
      projectId: parsed.projectId ?? parsed.project_id,
      clientEmail: parsed.clientEmail ?? parsed.client_email,
      privateKey: normalizePrivateKey(parsed.privateKey ?? parsed.private_key),
    };
  }

  return {
    projectId: required('FIREBASE_SERVICE_ACCOUNT_PROJECT_ID'),
    clientEmail: required('FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL'),
    privateKey: normalizePrivateKey(required('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY')),
  };
}

function getFirebaseMessaging() {
  if (!getApps().length) {
    logStep('firebase.initialize.start', {
      hasProjectId: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID),
      hasClientEmail: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL),
      hasPrivateKey: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY),
      hasServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    });

    initializeApp({
      credential: cert(buildServiceAccount()),
    });

    logStep('firebase.initialize.success', {
      appCount: getApps().length,
    });
  }

  return getMessaging();
}

async function sendPredictionTopicNotification({
  topicId,
  title,
  body,
  data = {},
}) {
  if (!topicId) {
    throw new Error('Missing Firebase topic id.');
  }

  logStep('firebase.messaging.send.start', {
    topicId,
    title,
    bodyLength: String(body || '').length,
    dataKeys: Object.keys(data || {}),
  });

  const messaging = getFirebaseMessaging();
  const messageId = await messaging.send({
    topic: topicId,
    notification: {
      title,
      body,
    },
    data: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value ?? '')]),
    ),
    android: {
      priority: 'high',
      notification: {
        channelId: 'appwrite_predictions',
      },
    },
  });

  logStep('firebase.messaging.send.success', {
    topicId,
    messageId,
  });

  return messageId;
}

module.exports = {
  getFirebaseMessaging,
  sendPredictionTopicNotification,
};
