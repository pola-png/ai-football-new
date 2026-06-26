import 'dart:convert';

import 'package:appwrite/appwrite.dart';

import 'app_auth_service.dart';
import 'appwrite_config.dart';

class AdminNotificationService {
  AdminNotificationService._();

  static final AdminNotificationService instance =
      AdminNotificationService._();

  late final Functions _functions = Functions(AppAuthService.instance.client);

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

    await _functions.createExecution(
      functionId: appwriteAdminNotificationFunctionId,
      method: ExecutionMethod.pOST,
      body: jsonEncode(payload),
    );
  }
}
