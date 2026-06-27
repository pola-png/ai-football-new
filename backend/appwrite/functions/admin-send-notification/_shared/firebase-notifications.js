import crypto from 'crypto';

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
  return String(value || '').replace(/\\n/g, '\n').trim();
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
  const parsed = JSON.parse(text);
  return typeof parsed === 'string' ? JSON.parse(cleanJsonText(parsed)) : parsed;
}

function buildServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    logStep('firebase.service_account.preview', {
      source: 'json',
      rawLength: String(raw || '').length,
      rawPreview: String(raw || '').slice(0, 120),
    });

    const parsed = parseServiceAccountJson(raw);
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

  return {
    projectId: required('FIREBASE_SERVICE_ACCOUNT_PROJECT_ID'),
    clientEmail: required('FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL'),
    privateKey: normalizePrivateKey(required('FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY')),
  };
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timeoutId);
    },
  };
}

function signJwt(payload, privateKey) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    {
      iss: serviceAccount.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.privateKey,
  );

  logStep('firebase.token.http.start', {
    projectId: serviceAccount.projectId,
    jwtLength: jwt.length,
  });

  const timeout = createTimeoutSignal(15000);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: timeout.signal,
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  }).finally(() => timeout.clear());

  const text = await response.text();
  logStep('firebase.token.http.done', {
    projectId: serviceAccount.projectId,
    status: response.status,
    ok: response.ok,
    responseLength: text.length,
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed with status ${response.status}: ${text}`);
  }

  const parsed = JSON.parse(text);
  if (!parsed.access_token) {
    throw new Error('OAuth token response did not include access_token.');
  }

  return parsed.access_token;
}

export async function sendPredictionTopicNotification({
  topicId,
  title,
  body,
  data = {},
}) {
  if (!topicId) {
    throw new Error('Missing Firebase topic id.');
  }

  const serviceAccount = buildServiceAccount();
  logStep('firebase.token.request.start', {
    projectId: serviceAccount.projectId,
    topicId,
    title,
    bodyLength: String(body || '').length,
    dataKeys: Object.keys(data || {}),
  });

  const accessToken = await getAccessToken(serviceAccount);

  logStep('firebase.token.request.success', {
    projectId: serviceAccount.projectId,
    topicId,
    tokenLength: accessToken.length,
  });

  const message = {
    message: {
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
          channel_id: 'appwrite_predictions',
        },
      },
    },
  };

  logStep('firebase.send.request.start', {
    projectId: serviceAccount.projectId,
    topicId,
    payloadKeys: Object.keys(message.message || {}),
  });

  const sendTimeout = createTimeoutSignal(15000);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
      signal: sendTimeout.signal,
    },
  ).finally(() => sendTimeout.clear());

  const responseText = await response.text();
  logStep('firebase.send.request.done', {
    projectId: serviceAccount.projectId,
    topicId,
    status: response.status,
    ok: response.ok,
    responseLength: responseText.length,
  });

  if (!response.ok) {
    throw new Error(`FCM request failed with status ${response.status}: ${responseText}`);
  }

  const parsed = JSON.parse(responseText);
  logStep('firebase.send.request.success', {
    projectId: serviceAccount.projectId,
    topicId,
    name: parsed.name || null,
  });

  return parsed.name || responseText;
}
