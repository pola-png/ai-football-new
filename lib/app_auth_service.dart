import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

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

  static const String _sessionReadyKey = 'app_auth_session_ready';

  static final AppAuthService instance = AppAuthService._();

  final FirebaseAuth _auth = FirebaseAuth.instance;
  SharedPreferences? _prefs;
  AppUserProfile? _currentUser;
  bool _initialized = false;
  bool _loading = false;
  bool _authResolved = false;

  bool get isLoading => _loading;
  bool get isSignedIn => _currentUser != null;
  AppUserProfile? get currentUser => _currentUser;

  Future<void> initialize() async {
    if (_initialized) {
      return;
    }
    _initialized = true;
    _prefs = await SharedPreferences.getInstance();

    // Restore from SharedPreferences first for immediate availability
    final isLogged = _prefs?.getBool('logged') ?? false;
    if (isLogged) {
      final savedId = _prefs?.getString('user_id');
      final savedEmail = _prefs?.getString('user_email');
      final savedName = _prefs?.getString('user_name');
      if (savedId != null) {
        _currentUser = AppUserProfile(
          id: savedId,
          email: savedEmail ?? '',
          name: savedName ?? '',
        );
        _authResolved = true;
      }
    }

    // Resolve the persisted Firebase session before the UI decides which page to show.
    User? initialUser;
    try {
      initialUser = await _auth.authStateChanges().first.timeout(
        const Duration(seconds: 5),
      );
    } catch (_) {
      initialUser = _auth.currentUser;
    }

    await _applyUser(initialUser);
    _authResolved = true;
    notifyListeners();

    // Keep listening for future sign-in/sign-out changes.
    _auth.authStateChanges().listen((User? user) async {
      _loading = true;
      notifyListeners();
      await _applyUser(user);
      _loading = false;
      _authResolved = true;
      notifyListeners();
    });
  }

  bool get isAuthResolved => _authResolved;

  Future<void> refreshSession() async {
    final user = _auth.currentUser;
    if (user != null) {
      try {
        await user.reload();
      } catch (_) {
        // user reload fail (e.g. user deleted or network issue)
      }
    }
    await _applyUser(_auth.currentUser);
    notifyListeners();
  }

  Future<void> signIn({
    required String email,
    required String password,
  }) async {
    _loading = true;
    notifyListeners();
    try {
      await _auth.signInWithEmailAndPassword(
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
    _loading = true;
    notifyListeners();
    try {
      final credential = await _auth.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      
      // Set display name in Firebase Auth
      if (credential.user != null) {
        await credential.user!.updateDisplayName(name.trim());
      }
      
      await refreshSession();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    _loading = true;
    notifyListeners();
    try {
      await _auth.signOut();
    } finally {
      _currentUser = null;
      _loading = false;
      _authResolved = true;
      await _prefs?.setBool(_sessionReadyKey, false);
      await _prefs?.setBool('logged', false);
      await _prefs?.remove('user_id');
      await _prefs?.remove('user_email');
      await _prefs?.remove('user_name');
      notifyListeners();
    }
  }

  Future<void> _applyUser(User? user) async {
    if (user != null) {
      _currentUser = AppUserProfile(
        id: user.uid,
        email: user.email ?? '',
        name: user.displayName ?? user.email?.split('@').first ?? '',
      );
      await _prefs?.setBool(_sessionReadyKey, true);
      await _prefs?.setBool('logged', true);
      await _prefs?.setString('user_id', user.uid);
      await _prefs?.setString('user_email', user.email ?? '');
      await _prefs?.setString('user_name', _currentUser!.name);
    } else {
      // Note: We don't force 'logged' to false here to prevent transient null values on startup
      // from logging the user out. Logout only happens via explicit signOut call.
      _currentUser = null;
      await _prefs?.setBool(_sessionReadyKey, false);
    }
  }
}
