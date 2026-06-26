import 'package:appwrite/appwrite.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_auth_service.dart';
import 'appwrite_config.dart';

class AdminAccessService extends ChangeNotifier {
  AdminAccessService._();

  static final AdminAccessService instance = AdminAccessService._();

  static const String _adminAccessKey = 'admin_access_enabled';
  static const String _adminPassword = 'Olami172@\$';

  SharedPreferences? _preferences;
  bool _initialized = false;
  bool _isAdmin = false;

  bool get isAdmin => _isAdmin;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;

    _preferences = await SharedPreferences.getInstance();
    _isAdmin = _preferences?.getBool(_adminAccessKey) ?? false;
    notifyListeners();
  }

  Future<void> syncFromBackend() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      await revoke();
      return;
    }

    try {
      final tables = TablesDB(AppAuthService.instance.client);
      final rows = await tables.listRows(
        databaseId: appwriteDatabaseId,
        tableId: appwriteUserProfilesTableId,
        queries: [
          Query.equal('user_id', user.id),
          Query.limit(1),
        ],
        total: false,
      );

      final backendIsAdmin = rows.rows.isNotEmpty &&
          _asBool(rows.rows.first.data['is_admin']);

      _isAdmin = backendIsAdmin;
      await _preferences?.setBool(_adminAccessKey, backendIsAdmin);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        notifyListeners();
      });
    } catch (_) {
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
