import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_config.dart';

class FirebaseSubscriptionService {
  Future<void> ensureSubscribed() async {
    final firebaseMessaging = FirebaseMessaging.instance;

    await firebaseMessaging.setAutoInitEnabled(true);
    await firebaseMessaging.requestPermission(alert: true, badge: true, sound: true);
    await firebaseMessaging.subscribeToTopic(firebasePredictionTopic);
    await firebaseMessaging.subscribeToTopic('chat_general');

    firebaseMessaging.onTokenRefresh.listen((_) async {
      await firebaseMessaging.subscribeToTopic(firebasePredictionTopic);
      await firebaseMessaging.subscribeToTopic('chat_general');
    });
  }
}
