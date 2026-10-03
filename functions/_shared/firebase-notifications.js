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

export function getFirebaseMessaging() {
  const apps = getApps();
  if (!apps.length) {
    const hasServiceAccountJson = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const hasSplitEnv = Boolean(
      process.env.FIREBASE_SERVICE_ACCOUNT_PROJECT_ID &&
      process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL &&
      process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
    );

    if (hasServiceAccountJson || hasSplitEnv) {
      try {
        initializeApp({
          credential: cert(buildServiceAccount()),
        });
      } catch (error) {
        console.warn('Failed to initialize Firebase Admin with credentials, falling back to default:', error.message);
        initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ai-football-predictions-48890',
        });
      }
    } else {
      initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'ai-football-predictions-48890',
      });
    }
  }

  return getMessaging(getApps()[0]);
}

export async function sendPredictionTopicNotification({
  topicId,
  title,
  body,
  data = {},
}) {
  const targetTopic = topicId || process.env.FIREBASE_PREDICTION_TOPIC || process.env.APPWRITE_TOPIC_PREDICTIONS || 'predictions';

  const messaging = getFirebaseMessaging();
  return messaging.send({
    topic: targetTopic,
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
        channelId: 'football_predictions',
        sound: 'default',
        icon: 'ic_launcher',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  });
}
