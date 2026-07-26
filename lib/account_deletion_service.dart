import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

class AccountDeletionService {
  AccountDeletionService._();

  static final AccountDeletionService instance = AccountDeletionService._();

  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  Future<void> deleteAccount({String? reason}) async {
    final payload = <String, dynamic>{
      'confirmation': 'DELETE',
      if (reason != null && reason.trim().isNotEmpty) 'reason': reason.trim(),
    };

    try {
      final result = await _functions.httpsCallable('deleteAccount').call(payload);
      
      debugPrint(
        'Account deletion call complete. Status: ${result.data}',
      );
    } catch (error) {
      debugPrint('Account deletion execution failed: $error');
      rethrow;
    }
  }
}
