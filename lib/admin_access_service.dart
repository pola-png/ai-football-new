import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
}
