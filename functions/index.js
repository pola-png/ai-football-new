import { initializeApp } from 'firebase-admin/app';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

// Initialize Firebase Admin SDK
initializeApp();

// 1. Cleanup Raw Fetch: Runs daily at 2:00 PM Lagos Time
export const cleanupRawFetch = onSchedule({
  schedule: '0 14 * * *',
  timeZone: 'Africa/Lagos',
  memory: '256MiB',
  timeoutSeconds: 300
}, async (event) => {
  console.log('Starting cleanupRawFetch schedule...');
  const main = (await import('./cleanup-raw-fetch/src/index.js')).default;
  const result = await main();
  console.log('cleanupRawFetch completed:', JSON.stringify(result));
  return result;
});

// 2. Daily Sync Generate: Runs daily at 1:30 AM Lagos Time
export const dailySyncGenerate = onSchedule({
  schedule: '30 1 * * *',
  timeZone: 'Africa/Lagos',
  memory: '512MiB',
  timeoutSeconds: 540
}, async (event) => {
  console.log('Starting dailySyncGenerate schedule...');
  const main = (await import('./daily-sync-generate/src/index.js')).default;
  const result = await main();
  console.log('dailySyncGenerate completed.');
  return result;
});

// 3. Generate Predictions: Runs daily at 2:00 AM Lagos Time (after dailySyncGenerate)
export const generatePredictions = onSchedule({
  schedule: '0 2 * * *',
  timeZone: 'Africa/Lagos',
  memory: '512MiB',
  timeoutSeconds: 540
}, async (event) => {
  console.log('Starting generatePredictions schedule...');
  const main = (await import('./generate-predictions/src/index.js')).default;
  const result = await main();
  console.log('generatePredictions completed.');
  return result;
});

// 4. Publish and Maintain: Runs every 30 minutes
export const publishAndMaintain = onSchedule({
  schedule: '*/30 * * * *',
  timeZone: 'Africa/Lagos',
  memory: '512MiB',
  timeoutSeconds: 540
}, async (event) => {
  console.log('Starting publishAndMaintain schedule...');
  const main = (await import('./publish-and-maintain/src/index.js')).default;
  const result = await main();
  console.log('publishAndMaintain completed.');
  return result;
});

// 5. Admin Send Notification: HTTPS Callable
export const adminSendNotification = onCall({
  memory: '256MiB',
  timeoutSeconds: 60
}, async (request) => {
  // Ensure user is authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in to send notifications.');
  }
  
  console.log(`adminSendNotification invoked by user: ${request.auth.uid}`);
  try {
    const main = (await import('./admin-send-notification/src/index.js')).default;
    const result = await main(request.data);
    return result;
  } catch (error) {
    console.error('adminSendNotification failed:', error);
    throw new HttpsError('internal', error.message || String(error));
  }
});

// 6. Delete Account: HTTPS Callable
export const deleteAccount = onCall({
  memory: '256MiB',
  timeoutSeconds: 120
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in to delete their account.');
  }

  const userId = request.auth.uid;
  console.log(`deleteAccount invoked for user: ${userId}`);

  const main = (await import('./delete-account/src/index.js')).default;
  const result = await main(userId, request.data);
  
  console.log(`deleteAccount finished successfully for user: ${userId}`);
  return result;
});
