import { sendPredictionTopicNotification } from '../_shared/firebase-notifications.js';

function parsePayload() {
  const rawPayload =
    process.env.APPWRITE_FUNCTION_DATA ||
    process.env.APPWRITE_FUNCTION_BODY ||
    process.env.APPWRITE_FUNCTION_PAYLOAD ||
    process.env.APPWRITE_FUNCTION_EVENT_DATA ||
    '';

  if (!rawPayload) {
    return {};
  }

  try {
    return JSON.parse(rawPayload);
  } catch {
    return {
      title: 'AI Football Prediction',
      body: String(rawPayload),
      data: {},
    };
  }
}

async function main() {
  const payload = parsePayload();
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const topicId = String(payload.topicId || process.env.APPWRITE_TOPIC_PREDICTIONS || '').trim();

  if (!title || !body) {
    throw new Error('Notification title and body are required.');
  }

  const messageId = await sendPredictionTopicNotification({
    topicId,
    title,
    body,
    data,
  });

  return {
    ok: true,
    message_id: messageId,
    topic_id: topicId,
  };
}

main().then(
  (result) => {
    console.log(JSON.stringify(result));
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
