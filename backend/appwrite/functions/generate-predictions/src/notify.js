import { sendPredictionTopicNotification } from '../_shared/firebase-notifications.js';

function shouldSendPredictionNotification(confidence) {
  return Number.isFinite(confidence) && confidence >= 0.85;
}

function buildMatchNotificationCopy({ fixture, confidence }) {
  const home = String(fixture?.home_team_name || 'Home').trim();
  const away = String(fixture?.away_team_name || 'Away').trim();
  const fixtureName = `${home} vs ${away}`;
  const confidenceLabel = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : 'high';

  return {
    title: fixtureName,
    body: `A new prediction is live with ${confidenceLabel} confidence.`,
  };
}

async function sendPredictionNotification({
  topicId,
  fixture,
  confidence,
  fixtureApiId,
  predictionId,
}) {
  const copy = buildMatchNotificationCopy({ fixture, confidence });

  await sendPredictionTopicNotification({
    topicId,
    title: copy.title,
    body: copy.body,
    data: {
      fixture_api_id: String(fixtureApiId || ''),
      prediction_id: String(predictionId || ''),
      release_status: 'published',
      confidence: String(confidence),
    },
  });

  return copy;
}

export {
  buildMatchNotificationCopy,
  sendPredictionNotification,
  shouldSendPredictionNotification,
};
