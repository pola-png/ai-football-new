import 'package:firebase_messaging/firebase_messaging.dart';

import 'appwrite_config.dart';

class AppwriteSubscriptionService {
  Future<void> ensureSubscribed() async {
    final firebaseMessaging = FirebaseMessaging.instance;

    await firebaseMessaging.setAutoInitEnabled(true);
    await firebaseMessaging.requestPermission(alert: true, badge: true, sound: true);
    await firebaseMessaging.subscribeToTopic(appwritePredictionTopicId);
    await firebaseMessaging.subscribeToTopic('chat_general');

    firebaseMessaging.onTokenRefresh.listen((_) async {
      await firebaseMessaging.subscribeToTopic(appwritePredictionTopicId);
      await firebaseMessaging.subscribeToTopic('chat_general');
    });
  }
}
