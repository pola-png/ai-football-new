import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

function logStep(step, details = {}) {
  console.log(JSON.stringify({
    level: 'info',
    component: 'firebase-notifications',
    step,
    timestamp: new Date().toISOString(),
    ...details,
  }));
}

function cleanJsonText(raw) {
  let text = String(raw || '').trim();

  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

function parseServiceAccountJson(rawJson) {
  const text = cleanJsonText(rawJson);

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? JSON.parse(cleanJsonText(parsed)) : parsed;
  } catch (error) {
    logStep('firebase.service_account.parse_failed', {
      rawLength: String(rawJson || '').length,
      rawPreview: String(rawJson || '').slice(0, 160),
      cleanedPreview: text.slice(0, 160),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function hasSplitServiceAccountEnv() {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID
      && process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL
      && process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

function buildSplitServiceAccount() {
  return {
    projectId: required('FIREBASE_SERVICE_ACCOUNT_PROJECT_ID'),
    clientEmail: required('FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL'),
    privateKey: normalizePrivateKey(required('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY')),
  };
}

function buildServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    logStep('firebase.service_account.preview', {
      source: 'json',
      rawLength: String(raw || '').length,
      rawPreview: String(raw || '').slice(0, 120),
    });

    let parsed = null;
    try {
      parsed = parseServiceAccountJson(raw);
    } catch (error) {
      if (hasSplitServiceAccountEnv()) {
        logStep('firebase.service_account.fallback_to_split_env', {
          reason: error instanceof Error ? error.message : String(error),
        });
        return buildSplitServiceAccount();
      }

      throw error;
    }

    return {
      projectId: parsed.projectId ?? parsed.project_id,
      clientEmail: parsed.clientEmail ?? parsed.client_email,
      privateKey: normalizePrivateKey(parsed.privateKey ?? parsed.private_key),
    };
  }

  logStep('firebase.service_account.preview', {
    source: 'split-env',
    hasProjectId: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID),
    hasClientEmail: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL),
    hasPrivateKey: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY),
  });

  return buildSplitServiceAccount();
}

function getFirebaseMessaging() {
  if (!getApps().length) {
    initializeApp({
      credential: cert(buildServiceAccount()),
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

  const messaging = getFirebaseMessaging();
  return messaging.send({
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
}

export {
  sendPredictionTopicNotification,
};
