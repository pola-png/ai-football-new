import 'dart:convert';

import 'package:appwrite/appwrite.dart' as appwrite;
import 'package:appwrite/enums.dart' as appwrite_enums;
import 'package:flutter/foundation.dart';

import 'app_auth_service.dart';
import 'appwrite_config.dart';

class AccountDeletionService {
  AccountDeletionService._();

  static final AccountDeletionService instance = AccountDeletionService._();

  late final appwrite.Functions _functions =
      appwrite.Functions(AppAuthService.instance.client);

  Future<void> deleteAccount({String? reason}) async {
    final payload = <String, dynamic>{
      'confirmation': 'DELETE',
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    };

    try {
      final execution = await _functions.createExecution(
        functionId: appwriteDeleteAccountFunctionId,
        method: appwrite_enums.ExecutionMethod.pOST,
        body: jsonEncode(payload),
      );

      debugPrint(
        'Account deletion execution started: '
        'id=${execution.$id}, status=${execution.status.value}, '
        'responseStatus=${execution.responseStatusCode}, '
        'responseBody=${execution.responseBody}, '
        'errors=${execution.errors}, logs=${execution.logs}',
      );
    } catch (error) {
      debugPrint('Account deletion execution failed: $error');
      rethrow;
    }
  }
}
