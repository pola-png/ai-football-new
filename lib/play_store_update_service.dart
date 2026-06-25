import 'package:flutter/foundation.dart';
import 'package:in_app_update/in_app_update.dart';

class PlayStoreUpdateService {
  PlayStoreUpdateService._();

  static Future<void> checkAndUpdate() async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return;
    }

    try {
      final info = await InAppUpdate.checkForUpdate();
      if (info.updateAvailability == UpdateAvailability.updateAvailable) {
        await InAppUpdate.performImmediateUpdate();
      }
    } catch (error) {
      debugPrint('Play Store immediate update failed: $error');
    }
  }
}
