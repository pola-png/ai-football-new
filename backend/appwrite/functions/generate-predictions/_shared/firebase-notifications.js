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

function extractLooseField(text, fieldName) {
  const pattern = new RegExp(`(?:^|[\\s,{])${fieldName}\\s*:\\s*([^,\\n}]+)`, 'i');
  const match = String(text || '').match(pattern);
  if (!match) {
    return null;
  }

  return String(match[1] || '').trim().replace(/^["']|["']$/g, '');
}

function extractLoosePrivateKey(text) {
  const source = String(text || '');
  const pemMatch = source.match(/private_key\s*:\s*(-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----)/i);
  if (pemMatch) {
    return pemMatch[1].trim();
  }

  const nextFieldMatch = source.match(/private_key\s*:\s*([\s\S]*?)(?:,\s*(?:private_key_id|client_email|project_id|type)\s*:|$)/i);
  if (!nextFieldMatch) {
    return null;
  }

  return String(nextFieldMatch[1] || '').trim().replace(/^["']|["']$/g, '');
}

function parseLooseServiceAccountText(rawJson) {
  const text = cleanJsonText(rawJson);
  const projectId = extractLooseField(text, 'project_id') || extractLooseField(text, 'projectId');
  const clientEmail = extractLooseField(text, 'client_email') || extractLooseField(text, 'clientEmail');
  const privateKey = extractLoosePrivateKey(text);

  if (!projectId && !clientEmail && !privateKey) {
    return null;
  }

  return {
    type: extractLooseField(text, 'type') || 'service_account',
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey ? privateKey.replace(/\\n/g, '\n').trim() : null,
  };
}

function parseServiceAccountJson(rawJson) {
  const text = cleanJsonText(rawJson);

  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? JSON.parse(cleanJsonText(parsed)) : parsed;
  } catch (error) {
    const looseParsed = parseLooseServiceAccountText(text);
    if (looseParsed) {
      logStep('firebase.service_account.loose_parse_success', {
        rawLength: String(rawJson || '').length,
        rawPreview: String(rawJson || '').slice(0, 160),
      });
      return looseParsed;
    }

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
