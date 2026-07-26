import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_auth_service.dart';
import 'firebase_config.dart';

class AdminAccessService extends ChangeNotifier {
  AdminAccessService._();

  static final AdminAccessService instance = AdminAccessService._();

  static const String _adminAccessKey = 'admin_access_enabled';
  static const String _adminPassword = 'Olami172@\$';

  SharedPreferences? _preferences;
  bool _initialized = false;
  bool _isAdmin = false;
  bool _simulateUserMode = false;

  bool get isAdmin => _isAdmin && !_simulateUserMode;
  bool get isActuallyAdmin => _isAdmin;
  bool get simulateUserMode => _simulateUserMode;

  Future<void> toggleUserMode() async {
    _simulateUserMode = !_simulateUserMode;
    notifyListeners();
  }

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;

    _preferences = await SharedPreferences.getInstance();
    _isAdmin = _preferences?.getBool(_adminAccessKey) ?? false;

    AppAuthService.instance.addListener(_handleAuthChange);

    notifyListeners();
  }

  void _handleAuthChange() {
    if (!AppAuthService.instance.isLoading && !AppAuthService.instance.isSignedIn) {
      revoke();
    }
  }

  Future<void> syncFromBackend() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      await revoke();
      return;
    }

    try {
      final doc = await FirebaseFirestore.instance
          .collection(firebaseUserProfilesCollection)
          .doc(user.id)
          .get();

      final backendIsAdmin = doc.exists && _asBool(doc.data()?['is_admin']);

      _isAdmin = backendIsAdmin;
      await _preferences?.setBool(_adminAccessKey, backendIsAdmin);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        notifyListeners();
      });
    } catch (error) {
      debugPrint('Admin role sync failed: $error');
      // Keep the existing local state if the backend profile lookup fails.
    }
  }

  Future<bool> unlock(String password) async {
    if (password != _adminPassword) {
      return false;
    }

    _isAdmin = true;
    await _preferences?.setBool(_adminAccessKey, true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      notifyListeners();
    });
    return true;
  }

  Future<void> revoke() async {
    _isAdmin = false;
    _simulateUserMode = false;
    await _preferences?.setBool(_adminAccessKey, false);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      notifyListeners();
    });
  }

  bool _asBool(Object? value) {
    if (value is bool) {
      return value;
    }
    if (value is String) {
      return value.toLowerCase() == 'true' || value == '1';
    }
    if (value is num) {
      return value != 0;
    }
    return false;
  }
}
