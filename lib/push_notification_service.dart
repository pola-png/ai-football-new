import 'dart:convert';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'app_auth_service.dart';

class PushNotificationService {
  PushNotificationService._();

  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  static const AndroidNotificationChannel _channel = AndroidNotificationChannel(
    'football_predictions',
    'Prediction notifications',
    description: 'Notifications for published football predictions.',
    importance: Importance.high,
  );

  static Future<void> initialize() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    await _localNotifications.initialize(
      initSettings,
      onDidReceiveNotificationResponse: (response) {
        if (response.payload != null && response.payload!.isNotEmpty) {
          // Payload can be handled later for deep links.
        }
      },
    );

    final androidPlugin = _localNotifications.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.requestNotificationsPermission();
    await androidPlugin?.createNotificationChannel(_channel);

    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.setAutoInitEnabled(true);
      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
      await messaging.subscribeToTopic('predictions');
      await messaging.subscribeToTopic('chat_general');

      messaging.onTokenRefresh.listen((_) async {
        try {
          await messaging.subscribeToTopic('predictions');
          await messaging.subscribeToTopic('chat_general');
        } catch (_) {}
      });
    } catch (e) {
      // Background topic subscription will retry
    }

    FirebaseMessaging.onMessage.listen(_showRemoteMessage);
    FirebaseMessaging.onMessageOpenedApp.listen(_handleOpenedMessage);

    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      _handleOpenedMessage(initialMessage);
    }
  }

  static Future<void> _showRemoteMessage(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) {
      return;
    }

    // Ignore push notifications sent by the current user themselves
    final senderUserId = message.data['userId']?.toString();
    if (senderUserId != null && senderUserId.isNotEmpty) {
      final currentUserId = AppAuthService.instance.currentUser?.id;
      if (currentUserId == senderUserId) {
        return;
      }
    }

    final androidDetails = AndroidNotificationDetails(
      _channel.id,
      _channel.name,
      channelDescription: _channel.description,
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );

    final details = NotificationDetails(android: androidDetails);
    final payload = jsonEncode(message.data);

    await _localNotifications.show(
      notification.hashCode,
      notification.title ?? 'AI Football Prediction',
      notification.body ?? 'Your football prediction is ready.',
      details,
      payload: payload,
    );
  }

  static void _handleOpenedMessage(RemoteMessage message) {
    // Hook for future navigation when a notification is tapped.
  }
}
