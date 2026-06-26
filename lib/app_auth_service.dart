import 'package:appwrite/appwrite.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'appwrite_config.dart';

class AppUserProfile {
  const AppUserProfile({
    required this.id,
    required this.email,
    required this.name,
  });

  final String id;
  final String email;
  final String name;
}

class AppAuthService extends ChangeNotifier {
  AppAuthService._();

  static final AppAuthService instance = AppAuthService._();

  static const String _sessionReadyKey = 'app_auth_session_ready';

  final Client _client = Client();
  Account? _account;
  SharedPreferences? _prefs;
  AppUserProfile? _currentUser;
  bool _initialized = false;
  bool _loading = false;

  bool get isLoading => _loading;
  bool get isSignedIn => _currentUser != null;
  AppUserProfile? get currentUser => _currentUser;

  Client get client {
    _configureClient();
    return _client;
  }

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;
    _prefs = await SharedPreferences.getInstance();
    _configureClient();
    await refreshSession();
  }

  void _configureClient() {
    if (appwriteEndpoint.isNotEmpty && appwriteProjectId.isNotEmpty) {
      _client.setEndpoint(appwriteEndpoint).setProject(appwriteProjectId);
    }
    _account ??= Account(_client);
  }

  Future<void> refreshSession() async {
    _configureClient();
    _loading = true;
    notifyListeners();

    try {
      final user = await _account!.get();
      _currentUser = AppUserProfile(
        id: user.$id,
        email: user.email,
        name: user.name.isNotEmpty ? user.name : user.email.split('@').first,
      );
      await _prefs?.setBool(_sessionReadyKey, true);
    } catch (_) {
      _currentUser = null;
      await _prefs?.setBool(_sessionReadyKey, false);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> signIn({
    required String email,
    required String password,
  }) async {
    _configureClient();
    _loading = true;
    notifyListeners();
    try {
      await _account!.createEmailPasswordSession(
        email: email.trim(),
        password: password,
      );
      await refreshSession();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> signUp({
    required String email,
    required String password,
    required String name,
  }) async {
    _configureClient();
    _loading = true;
    notifyListeners();
    try {
      await _account!.create(
        userId: ID.unique(),
        email: email.trim(),
        password: password,
        name: name.trim(),
      );
      await signIn(email: email, password: password);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    _configureClient();
    _loading = true;
    notifyListeners();
    try {
      await _account!.deleteSession(sessionId: 'current');
    } catch (_) {
      // Ignore stale sessions.
    } finally {
      _currentUser = null;
      _loading = false;
      await _prefs?.setBool(_sessionReadyKey, false);
      notifyListeners();
    }
  }
}
