import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:appwrite/appwrite.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'appwrite_config.dart';

class AppwriteSubscriptionService {
  AppwriteSubscriptionService({
    Client? client,
    SharedPreferences? preferences,
  })  : _client = client,
        _preferences = preferences;

  static const _deviceTargetKey = 'appwrite_device_target_id';
  static const _deviceSubscriberKey = 'appwrite_device_subscriber_id';
  static const _deviceFcmTokenKey = 'appwrite_device_fcm_token';
  static const _anonymousSessionKey = 'appwrite_anonymous_session_created';

  final Client? _client;
  final SharedPreferences? _preferences;

  Client get _resolvedClient {
    final client = _client ?? Client();
    if (appwriteEndpoint.isNotEmpty && appwriteProjectId.isNotEmpty) {
      client.setEndpoint(appwriteEndpoint).setProject(appwriteProjectId);
    }
    return client;
  }

  Future<void> ensureSubscribed() async {
    if (appwriteEndpoint.isEmpty || appwriteProjectId.isEmpty) {
      return;
    }

    final prefs = _preferences ?? await SharedPreferences.getInstance();
    final account = Account(_resolvedClient);
    final messaging = Messaging(_resolvedClient);
    final firebaseMessaging = FirebaseMessaging.instance;

    await _ensureAnonymousSession(account, prefs);
    await firebaseMessaging.setAutoInitEnabled(true);
    await firebaseMessaging.requestPermission(alert: true, badge: true, sound: true);

    final fcmToken = await firebaseMessaging.getToken();

    if (fcmToken == null || fcmToken.trim().isEmpty) {
      throw StateError('FCM token was not available on this device.');
    }

    final targetId = 'target-${DateTime.now().millisecondsSinceEpoch}';
    final subscriberId = 'subscriber-${DateTime.now().millisecondsSinceEpoch}';

    await account.createPushTarget(
      targetId: targetId,
      identifier: fcmToken,
    );
    await messaging.createSubscriber(
      topicId: appwritePredictionTopicId,
      subscriberId: subscriberId,
      targetId: targetId,
    );

    await prefs.setString(_deviceFcmTokenKey, fcmToken);
    await prefs.setString(_deviceTargetKey, targetId);
    await prefs.setString(_deviceSubscriberKey, subscriberId);
  }

  Future<void> _ensureAnonymousSession(
    Account account,
    SharedPreferences prefs,
  ) async {
    final hasSession = prefs.getBool(_anonymousSessionKey) ?? false;
    if (hasSession) {
      return;
    }

    try {
      await account.createAnonymousSession();
      await prefs.setBool(_anonymousSessionKey, true);
    } catch (_) {
      final existing = await account.get();
      if (existing.$id.isNotEmpty) {
        await prefs.setBool(_anonymousSessionKey, true);
      } else {
        rethrow;
      }
    }
  }
}
