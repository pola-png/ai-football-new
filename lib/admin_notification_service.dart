import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

class AdminNotificationService {
  AdminNotificationService._();

  static final AdminNotificationService instance =
      AdminNotificationService._();

  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  Future<void> sendNotification({
    required String title,
    required String body,
    Map<String, String>? data,
  }) async {
    final payload = <String, dynamic>{
      'title': title.trim(),
      'body': body.trim(),
      if (data != null && data.isNotEmpty) 'data': data,
    };

    try {
      final result = await _functions.httpsCallable('adminSendNotification').call(payload);

      debugPrint(
        'Admin notification call complete. Status: ${result.data}',
      );
    } catch (error) {
      debugPrint('Admin notification execution failed: $error');
      rethrow;
    }
  }
}
