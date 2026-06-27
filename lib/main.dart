import 'dart:async';
import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';
import 'app_auth_service.dart';
import 'admin_access_service.dart';
import 'admin_notification_page.dart';
import 'ad_gate_service.dart';
import 'appwrite_subscription_service.dart';
import 'community_page.dart';
import 'feed_banner_ad.dart';
import 'google_play_billing_service.dart';
import 'prediction_repository.dart';
import 'play_store_update_service.dart';
import 'social_engagement_service.dart';
import 'push_notification_service.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await PushNotificationService.initialize();
    await AdGateService.instance.initialize();
    await GooglePlayBillingService.instance.initialize();
    await AdminAccessService.instance.initialize();
    await AppAuthService.instance.initialize();
    await SocialEngagementService.instance.initialize();
  } catch (error) {
    debugPrint('Push subscription failed: $error');
    // Push subscription issues should not block the prediction feed.
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  ThemeData _buildTheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF0A0F1E) : const Color(0xFFF5F7FB);
    final card = isDark ? const Color(0xFF121B2E) : Colors.white;
    final textColor = isDark ? Colors.white : const Color(0xFF0F1A2C);
    final mutedText = isDark
        ? const Color(0xFF8C9FB8)
        : const Color(0xFF5A6E85);
    final accent = const Color(0xFF00D4AA);

    return ThemeData(
      colorScheme:
          ColorScheme.fromSeed(
            seedColor: accent,
            brightness: brightness,
          ).copyWith(
            primary: accent,
            secondary: const Color(0xFF2F80ED),
            surface: card,
            onSurface: textColor,
          ),
      useMaterial3: true,
      scaffoldBackgroundColor: surface,
      textTheme: ThemeData(
        brightness: brightness,
      ).textTheme.apply(bodyColor: textColor, displayColor: textColor),
      iconTheme: IconThemeData(size: 26, color: textColor),
      cardColor: card,
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: textColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          color: textColor,
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: card,
        indicatorColor: accent.withAlpha(35),
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: mutedText,
          ),
        ),
        iconTheme: WidgetStatePropertyAll(
          IconThemeData(size: 24, color: textColor),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Football Prediction',
      themeMode: ThemeMode.system,
      builder: (context, child) {
        final scaledChild = child ?? const SizedBox.shrink();
        return MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.15)),
          child: scaledChild,
        );
      },
      theme: _buildTheme(Brightness.light),
      darkTheme: _buildTheme(Brightness.dark),
      home: const AuthGatePage(),
      routes: {
        '/popular': (context) {
          final args = ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
          return PopularMatchesPage(
            predictions: args?['predictions'] as List<PredictionRecord>? ?? const [],
            adFree: args?['adFree'] as bool? ?? false,
            isAdmin: args?['isAdmin'] as bool? ?? false,
          );
        },
      },
    );
  }
}

bool _isDarkContext(BuildContext context) {
  return Theme.of(context).brightness == Brightness.dark;
}

List<Color> _screenGradient(BuildContext context) {
  return _isDarkContext(context)
      ? const [Color(0xFF0A0F1E), Color(0xFF10172A), Color(0xFF17233E)]
      : const [Color(0xFFF5F7FB), Color(0xFFE9EDF5), Color(0xFFDEE5EE)];
}

Color _screenSurface(BuildContext context, {bool elevated = false}) {
  if (_isDarkContext(context)) {
    return elevated ? const Color(0xFF1E293B) : const Color(0xFF121B2E);
  }
  return elevated ? const Color(0xFFE8EEF5) : Colors.white;
}

Color _screenBorder(BuildContext context) {
  return _isDarkContext(context)
      ? const Color(0xFF1E2B4C)
      : const Color(0xFFE2EAF2);
}

Color _primaryText(BuildContext context) {
  return _isDarkContext(context) ? Colors.white : const Color(0xFF0F1A2C);
}

Color _secondaryText(BuildContext context) {
  return _isDarkContext(context)
      ? const Color(0xFF8C9FB8)
      : const Color(0xFF5A6E85);
}

Color _accentText(BuildContext context) {
  return _isDarkContext(context)
      ? const Color(0xFF75F7D7)
      : const Color(0xFF009680);
}

Color _navBackground(BuildContext context) {
  return _isDarkContext(context) ? const Color(0xFF0A0F1E) : Colors.white;
}

Color _inputFill(BuildContext context) {
  return _isDarkContext(context) ? const Color(0xFF121B2E) : Colors.white;
}

class AuthGatePage extends StatelessWidget {
  const AuthGatePage({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AppAuthService.instance,
      builder: (context, _) {
        if (AppAuthService.instance.isLoading) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (!AppAuthService.instance.isSignedIn) {
          return const AuthPage();
        }

        return const NotificationBootstrapPage();
      },
    );
  }
}

class AuthPage extends StatefulWidget {
  const AuthPage({super.key});

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _signInEmail = TextEditingController();
  final _signInPassword = TextEditingController();
  final _signUpName = TextEditingController();
  final _signUpEmail = TextEditingController();
  final _signUpPassword = TextEditingController();
  bool _isSignIn = true;

  @override
  void dispose() {
    _signInEmail.dispose();
    _signInPassword.dispose();
    _signUpName.dispose();
    _signUpEmail.dispose();
    _signUpPassword.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final auth = AppAuthService.instance;
    try {
      if (_isSignIn) {
        await auth.signIn(
          email: _signInEmail.text,
          password: _signInPassword.text,
        );
      } else {
        await auth.signUp(
          name: _signUpName.text,
          email: _signUpEmail.text,
          password: _signUpPassword.text,
        );
      }
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Authentication failed: $error')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    return AnimatedBuilder(
      animation: AppAuthService.instance,
      builder: (context, _) {
        return Scaffold(
          backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          body: SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Card(
                    elevation: 0,
                    color: _screenSurface(context),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: BorderSide(color: _screenBorder(context)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'AI Football Prediction',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: primaryText,
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Sign in to continue.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: secondaryText,
                              fontSize: 14,
                            ),
                          ),
                          const SizedBox(height: 20),
                          Row(
                            children: [
                              Expanded(
                                child: _AuthModeButton(
                                  label: 'Sign in',
                                  selected: _isSignIn,
                                  onTap: () => setState(() => _isSignIn = true),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: _AuthModeButton(
                                  label: 'Sign up',
                                  selected: !_isSignIn,
                                  onTap: () => setState(() => _isSignIn = false),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 20),
                          if (_isSignIn) ...[
                            _AuthField(
                              controller: _signInEmail,
                              hint: 'Email',
                              keyboardType: TextInputType.emailAddress,
                            ),
                            const SizedBox(height: 12),
                            _AuthField(
                              controller: _signInPassword,
                              hint: 'Password',
                              obscureText: true,
                            ),
                          ] else ...[
                            _AuthField(controller: _signUpName, hint: 'Display name'),
                            const SizedBox(height: 12),
                            _AuthField(
                              controller: _signUpEmail,
                              hint: 'Email',
                              keyboardType: TextInputType.emailAddress,
                            ),
                            const SizedBox(height: 12),
                            _AuthField(
                              controller: _signUpPassword,
                              hint: 'Password',
                              obscureText: true,
                            ),
                          ],
                          const SizedBox(height: 20),
                          FilledButton(
                            onPressed: AppAuthService.instance.isLoading ? null : _submit,
                            child: Text(
                              AppAuthService.instance.isLoading
                                  ? 'Please wait...'
                                  : (_isSignIn ? 'Sign in' : 'Create account'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _AuthModeButton extends StatelessWidget {
  const _AuthModeButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final border = _screenBorder(context);

    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        backgroundColor:
            selected ? const Color(0xFF00D4AA).withAlpha(24) : Colors.transparent,
        foregroundColor: selected ? const Color(0xFF00D4AA) : primaryText,
        side: BorderSide(color: selected ? const Color(0xFF00D4AA) : border),
        padding: const EdgeInsets.symmetric(vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
      child: Text(
        label,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _AuthField extends StatelessWidget {
  const _AuthField({
    required this.controller,
    required this.hint,
    this.obscureText = false,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String hint;
  final bool obscureText;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: _inputFill(context),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}

class NotificationBootstrapPage extends StatefulWidget {
  const NotificationBootstrapPage({super.key});

  @override
  State<NotificationBootstrapPage> createState() =>
      _NotificationBootstrapPageState();
}

class _NotificationBootstrapPageState extends State<NotificationBootstrapPage> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _bootstrap();
    });
  }

  Future<void> _bootstrap() async {
    try {
      await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        announcement: false,
        carPlay: false,
        criticalAlert: false,
        provisional: false,
      );
      await Permission.notification.request();
      await AppwriteSubscriptionService().ensureSubscribed();
      await SocialEngagementService.instance.ensureProfile();
      await AdminAccessService.instance.syncFromBackend();
    } catch (error) {
      debugPrint('Push subscription failed: $error');
    }

    await PlayStoreUpdateService.checkAndUpdate();

    if (!mounted) {
      return;
    }

    setState(() {
      _ready = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return const PredictionFeedPage();
  }
}

class PredictionFeedPage extends StatefulWidget {
  const PredictionFeedPage({super.key});

  @override
  State<PredictionFeedPage> createState() => _PredictionFeedPageState();
}

class _PredictionFeedPageState extends State<PredictionFeedPage> {
  final Map<String, PredictionRecord> _selectedPredictions =
      <String, PredictionRecord>{};
  int _currentIndex = 0;
  bool _adFreeUpsellShown = false;

  Future<void> _openMainMenu(bool isAdmin) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => _MainMenuPage(
          isAdmin: isAdmin,
          onNavigate: _setIndex,
          onOpenPolicy: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const PolicyPage(),
              ),
            );
          },
          onOpenAdminNotification: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AdminNotificationPage(),
              ),
            );
          },
          onLogout: () async {
            await AppAuthService.instance.signOut();
          },
        ),
      ),
    );
  }

  List<PredictionRecord> get _selectedItems {
    final items = _selectedPredictions.values.toList();
    items.sort(_comparePredictionsByKickoff);
    return items;
  }

  void _setIndex(int index) {
    if (_currentIndex == index) {
      return;
    }

    setState(() {
      _currentIndex = index;
    });
  }

  void _toggleSelectedPrediction(PredictionRecord prediction) {
    final key = _predictionUnlockKey(prediction);
    if (key.isEmpty) {
      return;
    }

    setState(() {
      if (_selectedPredictions.containsKey(key)) {
        _selectedPredictions.remove(key);
      } else {
        _selectedPredictions[key] = prediction;
      }
    });

    SocialEngagementService.instance.recordSelection(
      fixtureApiId: prediction.fixtureApiId,
      selection: _selectedPredictions.containsKey(key)
          ? (prediction.primaryPick?.selection ?? prediction.predictedWinner ?? '')
          : '',
    );
  }

  void _clearSelections() {
    if (_selectedPredictions.isEmpty) {
      return;
    }

    setState(() {
      _selectedPredictions.clear();
    });
  }

  void _openPickedTab() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PickedMatchesPage(
          selectedPredictions: _selectedItems,
          onClearAll: _selectedItems.isEmpty ? null : _clearSelections,
        ),
      ),
    );
  }

  void _maybeShowAdFreeUpsell(bool adFree) {
    if (adFree || _adFreeUpsellShown) {
      return;
    }

    _adFreeUpsellShown = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }

      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) {
          final primaryText = _primaryText(sheetContext);
          final secondaryText = _secondaryText(sheetContext);
          final surface = _screenSurface(sheetContext, elevated: true);
          final border = _screenBorder(sheetContext);
          final accentText = _accentText(sheetContext);
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: _isDarkContext(sheetContext)
                      ? const [
                          Color(0xFF07111F),
                          Color(0xFF0E2238),
                          Color(0xFF163B57),
                        ]
                      : const [
                          Color(0xFFFDFEFF),
                          Color(0xFFEAF5FF),
                          Color(0xFFDCEEFF),
                        ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(32),
                border: Border.all(color: border),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x26000000),
                    blurRadius: 28,
                    offset: Offset(0, 18),
                  ),
                ],
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFF00D4AA).withAlpha(28),
                              borderRadius: BorderRadius.circular(18),
                            ),
                            child: Icon(
                              Icons.workspace_premium,
                              color: accentText,
                              size: 28,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Text(
                              'Go ad free for 7 days',
                              style: TextStyle(
                                color: primaryText,
                                fontSize: 22,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'Unlock a cleaner experience, keep the app flowing, and remove banner interruptions for a full week.',
                        style: TextStyle(
                          color: secondaryText,
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: surface,
                          borderRadius: BorderRadius.circular(22),
                          border: Border.all(color: border),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: const [
                            _PlanBenefitLine(text: '7-day ad-free access'),
                            SizedBox(height: 10),
                            _PlanBenefitLine(text: 'Fresh, distraction-free layout'),
                            SizedBox(height: 10),
                            _PlanBenefitLine(text: 'Perfect short-term upgrade'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          Expanded(
                            child: FilledButton(
                              onPressed: () {
                                Navigator.of(sheetContext).pop();
                                _setIndex(1);
                              },
                              style: FilledButton.styleFrom(
                                backgroundColor: const Color(0xFF00D4AA),
                                foregroundColor: const Color(0xFF07111F),
                                padding: const EdgeInsets.symmetric(vertical: 15),
                              ),
                              child: const Text(
                                'See plans',
                                style: TextStyle(fontWeight: FontWeight.w900),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          TextButton(
                            onPressed: () => Navigator.of(sheetContext).pop(),
                            child: const Text('Maybe later'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: GooglePlayBillingService.instance,
      builder: (context, _) {
        return AnimatedBuilder(
          animation: AdminAccessService.instance,
          builder: (context, _) {
            final isAdmin = AdminAccessService.instance.isAdmin;
            final adFree =
                GooglePlayBillingService.instance.hasAdFreeAccess || isAdmin;
            final rewardedAdFree =
                GooglePlayBillingService.instance.hasRewardedAdFreeAccess || isAdmin;
            final activePlan = GooglePlayBillingService.instance.activePlan;
            _maybeShowAdFreeUpsell(adFree);

            return Scaffold(
              body: IndexedStack(
                index: _currentIndex,
                children: [
                  _PredictionHomeTab(
                    adFree: rewardedAdFree,
                    isAdmin: isAdmin,
                    isPremiumUser:
                        activePlan == SubscriptionPlanId.premium || isAdmin,
                    selectedCount: _selectedItems.length,
                    isPredictionSelected: (prediction) => _selectedPredictions
                        .containsKey(_predictionUnlockKey(prediction)),
                    onToggleSelection: _toggleSelectedPrediction,
                    onOpenPicked: _openPickedTab,
                    onOpenPremium: () => _setIndex(1),
                    onOpenMenu: () => _openMainMenu(isAdmin),
                  ),
                  PremiumPlanPage(
                    adFree: adFree,
                    isAdmin: isAdmin,
                    currentPlans: GooglePlayBillingService.instance.plans,
                  ),
                  const CommunityPage(),
                ],
              ),
              bottomNavigationBar: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_selectedItems.isNotEmpty)
                    _SelectedMatchesBar(
                      count: _selectedItems.length,
                      onOpenPicked: _openPickedTab,
                      onClear: _clearSelections,
                    ),
                  ClipRect(
                    child: BackdropFilter(
                      filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                      child: Container(
                        decoration: BoxDecoration(
                          color: _navBackground(context).withValues(alpha: 0.72),
                          border: Border(
                            top: BorderSide(
                              color: _screenBorder(context).withValues(alpha: 0.5),
                              width: 1.0,
                            ),
                          ),
                        ),
                        child: NavigationBar(
                          selectedIndex: _currentIndex,
                          onDestinationSelected: _setIndex,
                          backgroundColor: Colors.transparent,
                          elevation: 0,
                          indicatorColor: const Color(0xFF00D4AA).withAlpha(40),
                          destinations: [
                            NavigationDestination(
                              icon: const Icon(Icons.home_outlined),
                              selectedIcon: _PulsingIcon(
                                icon: Icons.home,
                                isActive: _currentIndex == 0,
                              ),
                              label: 'Home',
                            ),
                            NavigationDestination(
                              icon: const Icon(Icons.workspace_premium_outlined),
                              selectedIcon: _PulsingIcon(
                                icon: Icons.workspace_premium,
                                isActive: _currentIndex == 1,
                              ),
                              label: 'Premium Plan',
                            ),
                            NavigationDestination(
                              icon: const Icon(Icons.chat_bubble_outline),
                              selectedIcon: _PulsingIcon(
                                icon: Icons.chat_bubble,
                                isActive: _currentIndex == 2,
                              ),
                              label: 'Group',
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

enum _ConfidenceFilter { all, high, medium }

extension _ConfidenceFilterX on _ConfidenceFilter {
  String get label => switch (this) {
    _ConfidenceFilter.all => 'All',
    _ConfidenceFilter.high => 'High',
    _ConfidenceFilter.medium => 'Medium',
  };
}

class _MainMenuPage extends StatelessWidget {
  const _MainMenuPage({
    required this.isAdmin,
    required this.onNavigate,
    required this.onOpenPolicy,
    required this.onOpenAdminNotification,
    required this.onLogout,
  });

  final bool isAdmin;
  final ValueChanged<int> onNavigate;
  final VoidCallback onOpenPolicy;
  final VoidCallback onOpenAdminNotification;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Menu'),
        backgroundColor: surface,
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: _screenGradient(context),
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Navigate the app from one place.',
              style: TextStyle(
                color: secondaryText,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 16),
            _menuTile(
              context,
              icon: Icons.home_outlined,
              title: 'Home',
              subtitle: 'Back to predictions',
              border: border,
              textColor: primaryText,
              onTap: () {
                onNavigate(0);
                Navigator.of(context).pop();
              },
            ),
            _menuTile(
              context,
              icon: Icons.workspace_premium_outlined,
              title: 'Premium Plan',
              subtitle: 'View your plans and unlockables',
              border: border,
              textColor: primaryText,
              onTap: () {
                onNavigate(1);
                Navigator.of(context).pop();
              },
            ),
            _menuTile(
              context,
              icon: Icons.fact_check_outlined,
              title: 'Picked Matches',
              subtitle: 'See saved picks',
              border: border,
              textColor: primaryText,
              onTap: () {
                onNavigate(2);
                Navigator.of(context).pop();
              },
            ),
            _menuTile(
              context,
              icon: Icons.people_outline,
              title: 'Group',
              subtitle: 'Leaderboard and check-ins',
              border: border,
              textColor: primaryText,
              onTap: () {
                onNavigate(2);
                Navigator.of(context).pop();
              },
            ),
            _menuTile(
              context,
              icon: Icons.policy_outlined,
              title: 'Policy',
              subtitle: 'App policy and privacy',
              border: border,
              textColor: primaryText,
              onTap: () {
                Navigator.of(context).pop();
                onOpenPolicy();
              },
            ),
            if (isAdmin)
              _menuTile(
                context,
                icon: Icons.notifications_active_outlined,
                title: 'Admin Notification',
                subtitle: 'Send a broadcast to users',
                border: border,
                textColor: primaryText,
                onTap: () {
                  Navigator.of(context).pop();
                  onOpenAdminNotification();
                },
              ),
            const SizedBox(height: 8),
            _menuTile(
              context,
              icon: Icons.logout,
              title: 'Log out',
              subtitle: 'Sign out of your account',
              border: border,
              textColor: const Color(0xFFFF6B6B),
              destructive: true,
              onTap: () async {
                Navigator.of(context).pop();
                await onLogout();
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _menuTile(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required Color border,
    required Color textColor,
    required VoidCallback onTap,
    bool destructive = false,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: _screenSurface(context, elevated: true),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: ListTile(
        leading: Icon(icon, color: destructive ? const Color(0xFFFF6B6B) : _accentText(context)),
        title: Text(
          title,
          style: TextStyle(
            color: destructive ? const Color(0xFFFF6B6B) : textColor,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(subtitle, style: TextStyle(color: _secondaryText(context))),
        onTap: onTap,
      ),
    );
  }
}

class _PredictionHomeTab extends StatefulWidget {
  const _PredictionHomeTab({
    required this.adFree,
    required this.isAdmin,
    required this.isPremiumUser,
    required this.selectedCount,
    required this.isPredictionSelected,
    required this.onToggleSelection,
    required this.onOpenPicked,
    required this.onOpenPremium,
    required this.onOpenMenu,
  });

  final bool adFree;
  final bool isAdmin;
  final bool isPremiumUser;
  final int selectedCount;
  final bool Function(PredictionRecord prediction) isPredictionSelected;
  final void Function(PredictionRecord prediction) onToggleSelection;
  final VoidCallback onOpenPicked;
  final VoidCallback onOpenPremium;
  final VoidCallback onOpenMenu;

  @override
  State<_PredictionHomeTab> createState() => _PredictionHomeTabState();
}

class _PredictionHomeTabState extends State<_PredictionHomeTab> {
  final PredictionRepository _repository = PredictionRepository();
  late Future<List<PredictionRecord>> _futurePredictions;
  final Set<String> _expandedSectionKeys = <String>{};
  final Set<String> _unlockedPickKeys = <String>{};
  _TodayBucket _selectedTodayBucket = _TodayBucket.coming;
  String? _unlockingPickKey;
  String _searchQuery = '';
  _ConfidenceFilter _confidenceFilter = _ConfidenceFilter.all;

  @override
  void initState() {
    super.initState();
    _futurePredictions = _repository.fetchPublishedPredictions();
  }

  Future<void> _reload() async {
    setState(() {
      _futurePredictions = _repository.fetchPublishedPredictions();
    });
    await _futurePredictions;
  }

  void _toggleSection(String key) {
    setState(() {
      if (_expandedSectionKeys.contains(key)) {
        _expandedSectionKeys.remove(key);
      } else {
        _expandedSectionKeys.add(key);
      }
    });
  }

  void _selectTodayBucket(_TodayBucket bucket) {
    if (_selectedTodayBucket == bucket) {
      return;
    }

    setState(() {
      _selectedTodayBucket = bucket;
    });
  }

  bool _isPickUnlocked(String unlockKey) {
    return widget.adFree || _unlockedPickKeys.contains(unlockKey);
  }

  Future<void> _unlockPick(PredictionRecord prediction) async {
    if (widget.adFree) {
      return;
    }

    final unlockKey = _predictionUnlockKey(prediction);
    if (unlockKey.isEmpty || _unlockedPickKeys.contains(unlockKey)) {
      return;
    }

    if (_unlockingPickKey == unlockKey) {
      return;
    }

    setState(() {
      _unlockingPickKey = unlockKey;
    });

    try {
      final didUnlock = await AdGateService.instance.showRewardedAd();
      if (!mounted) {
        return;
      }

      if (didUnlock) {
        setState(() {
          _unlockedPickKeys.add(unlockKey);
        });
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ad not ready yet. Please try again.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _unlockingPickKey = null;
        });
      }
    }
  }

  bool _matchesFilter(PredictionRecord prediction) {
    final query = _searchQuery.trim().toLowerCase();
    final home = prediction.homeTeamName?.toLowerCase() ?? '';
    final away = prediction.awayTeamName?.toLowerCase() ?? '';
    final winner = prediction.predictedWinner?.toLowerCase() ?? '';
    final confidence = _confidenceBadgeLabel(prediction).toLowerCase();
    final confidencePercent = _predictionConfidencePercent(prediction);

    final queryMatch =
        query.isEmpty ||
        home.contains(query) ||
        away.contains(query) ||
        winner.contains(query) ||
        _matchStatusLabel(prediction).toLowerCase().contains(query) ||
        _formatTimeOnly(
          prediction.kickoffAt ?? prediction.releaseAt,
        ).toLowerCase().contains(query);

    final confidenceMatch = switch (_confidenceFilter) {
      _ConfidenceFilter.all => true,
      _ConfidenceFilter.high => confidence == 'high',
      _ConfidenceFilter.medium => confidence == 'medium',
    };

    return queryMatch &&
        confidenceMatch &&
        (widget.isAdmin || confidencePercent < 85);
  }

  bool get _isHighFilterSelected => _confidenceFilter == _ConfidenceFilter.high;

  void _handleSelectPrediction(PredictionRecord prediction) {
    final unlockKey = _predictionUnlockKey(prediction);
    final isUnlocked = _isPickUnlocked(unlockKey);
    if (!isUnlocked) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unlock this pick before selecting it.')),
      );
      return;
    }

    widget.onToggleSelection(prediction);
  }

  Future<void> _openComments(PredictionRecord prediction) {
    return showPredictionCommentsSheet(context, prediction);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final pageGradient = _screenGradient(context);
    final surface = _screenSurface(context);


    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: pageGradient,
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: SafeArea(
        child: FutureBuilder<List<PredictionRecord>>(
          future: _futurePredictions,
          builder: (context, snapshot) {
            final predictions = snapshot.data ?? const <PredictionRecord>[];
            final filteredPredictions = predictions
                .where(_matchesFilter)
                .toList();

            return RefreshIndicator(
              onRefresh: _reload,
              color: const Color(0xFF00D4AA),
              backgroundColor: surface,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverAppBar(
                    pinned: true,
                    floating: false,
                    toolbarHeight: 110,
                    backgroundColor: Colors.transparent,
                    surfaceTintColor: Colors.transparent,
                    elevation: 0,
                    titleSpacing: 20,
                    title: _StickyHeader(
                      searchQuery: _searchQuery,
                      onSearchChanged: (value) {
                        setState(() {
                          _searchQuery = value;
                        });
                      },
                      onClearSearch: _searchQuery.isEmpty
                          ? null
                          : () {
                              setState(() {
                                _searchQuery = '';
                              });
                            },
                      onOpenMenu: widget.onOpenMenu,
                    ),
                    flexibleSpace: ClipRect(
                      child: BackdropFilter(
                        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                        child: Container(
                          decoration: BoxDecoration(
                            color: (isDark ? const Color(0xFF0A0F1E) : Colors.white).withValues(alpha: 0.72),
                            border: Border(
                              bottom: BorderSide(
                                color: _screenBorder(context).withValues(alpha: 0.5),
                                width: 1.0,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 10, 20, 12),
                      child: _HeaderInfoCarousel(
                        predictions: predictions,
                        onOpenPremium: widget.onOpenPremium,
                        onOpenPopularMatches: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PopularMatchesPage(
                                predictions: predictions,
                                adFree: widget.adFree,
                                isAdmin: widget.isAdmin,
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ),
                  if (_isHighFilterSelected)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                        child: _PremiumUpgradeGate(
                          isPremiumUser: widget.isPremiumUser || widget.isAdmin,
                          onOpenPremium: widget.onOpenPremium,
                        ),
                      ),
                    )
                  else if (snapshot.connectionState ==
                          ConnectionState.waiting &&
                      predictions.isEmpty)
                    const SliverToBoxAdapter(
                      child: Center(
                        child: Padding(
                          padding: EdgeInsets.only(top: 32),
                          child: CircularProgressIndicator(),
                        ),
                      ),
                    )
                  else if (snapshot.hasError)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                        child: _EmptyState(
                          icon: Icons.error_outline,
                          title: 'Unable to load predictions',
                          message: 'Pull to refresh and try again.',
                          actionLabel: 'Retry',
                          onAction: _reload,
                        ),
                      ),
                    )
                  else if (filteredPredictions.isEmpty)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                        child: _EmptyState(
                          icon: Icons.sports_soccer,
                          title: 'No matching picks',
                          message:
                              'Try a different search term or change the confidence filter.',
                          actionLabel: predictions.isEmpty
                              ? null
                              : 'Clear filters',
                          onAction: predictions.isEmpty
                              ? null
                              : () {
                                  setState(() {
                                    _searchQuery = '';
                                    _confidenceFilter = _ConfidenceFilter.all;
                                  });
                                },
                        ),
                      ),
                    )
                  else
                    SliverList(
                      delegate: SliverChildListDelegate(
                        _buildGroupedPredictionWidgets(
                          context,
                          filteredPredictions,
                          _expandedSectionKeys,
                          _toggleSection,
                          _selectedTodayBucket,
                          _selectTodayBucket,
                          _isPickUnlocked,
                          _unlockPick,
                          _unlockingPickKey,
                          widget.adFree,
                          widget.isPredictionSelected,
                          _handleSelectPrediction,
                          _openComments,
                          !widget.adFree,
                        ),
                      ),
                    ),
                  SliverToBoxAdapter(
                    child: SizedBox(
                      height: widget.selectedCount > 0 ? 140 : 96,
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class PremiumPlanPage extends StatefulWidget {
  const PremiumPlanPage({
    super.key,
    required this.adFree,
    required this.isAdmin,
    required this.currentPlans,
  });

  final bool adFree;
  final bool isAdmin;
  final List<SubscriptionPlanId> currentPlans;

  @override
  State<PremiumPlanPage> createState() => _PremiumPlanPageState();
}

class _PremiumPlanPageState extends State<PremiumPlanPage> {
  final PredictionRepository _repository = PredictionRepository();
  late Future<List<PredictionRecord>> _futurePredictions;
  SubscriptionPlanId? _selectedPlanOverride;
  bool _showPurchaseScreen = false;

  @override
  void initState() {
    super.initState();
    _futurePredictions = _repository.fetchPublishedPredictions();
    _selectedPlanOverride =
        GooglePlayBillingService.instance.activePlan ??
        SubscriptionPlanId.premium;
  }

  Future<void> _buyPlan(BuildContext context, SubscriptionPlanId plan) async {
    try {
      await GooglePlayBillingService.instance.purchase(plan);
    } catch (error) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Unable to start purchase: $error')),
      );
    }
  }

  Future<void> _reload() async {
    setState(() {
      _futurePredictions = _repository.fetchPublishedPredictions();
    });
    await _futurePredictions;
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: GooglePlayBillingService.instance,
      builder: (context, _) {
        final billing = GooglePlayBillingService.instance;
        final isAdmin = widget.isAdmin;
        final activePlan = billing.activePlan;
        final hasAccess = widget.adFree || isAdmin || activePlan != null;
        final selectedPlan = isAdmin
            ? _selectedPlanOverride ?? activePlan ?? SubscriptionPlanId.premium
            : activePlan ?? _selectedPlanOverride ?? SubscriptionPlanId.premium;
        final purchasePlan = _selectedPlanOverride ?? activePlan ?? SubscriptionPlanId.premium;
        final showingPurchaseScreen =
            !isAdmin && activePlan != null && _showPurchaseScreen && purchasePlan != activePlan;
        final headerTitle = showingPurchaseScreen
            ? 'Subscribe to ${purchasePlan.title}'
            : selectedPlan.title;

        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: _screenGradient(context),
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
          ),
          child: SafeArea(
            child: hasAccess
                ? showingPurchaseScreen
                    ? _buildPurchaseScreen(
                        context: context,
                        billing: billing,
                        purchasePlan: purchasePlan,
                        activePlan: activePlan,
                        isAdmin: isAdmin,
                      )
                    : Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                headerTitle,
                                style: TextStyle(
                                  color: _primaryText(context),
                                  fontSize: 28,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            if (isAdmin)
                              PopupMenuButton<SubscriptionPlanId>(
                                tooltip: 'Switch plan',
                                onSelected: (plan) {
                                  setState(() {
                                    _selectedPlanOverride = plan;
                                  });
                                },
                                itemBuilder: (context) {
                                  return widget.currentPlans.map((plan) {
                                    return PopupMenuItem<SubscriptionPlanId>(
                                      value: plan,
                                      child: Row(
                                        children: [
                                          Icon(
                                            Icons.workspace_premium_outlined,
                                            size: 18,
                                          ),
                                          const SizedBox(width: 10),
                                          Expanded(child: Text(plan.title)),
                                        ],
                                      ),
                                    );
                                  }).toList();
                                },
                                child: Icon(
                                  Icons.menu_open,
                                  color: _accentText(context),
                                ),
                              ),
                            if (!isAdmin &&
                                activePlan != null &&
                                widget.currentPlans.any((plan) => plan != activePlan))
                              PopupMenuButton<SubscriptionPlanId>(
                                tooltip: 'Choose a plan',
                                onSelected: (plan) {
                                  setState(() {
                                    _selectedPlanOverride = plan;
                                    _showPurchaseScreen = true;
                                  });
                                },
                                itemBuilder: (context) {
                                  return widget.currentPlans
                                      .where((plan) => plan != activePlan)
                                      .map((plan) {
                                        return PopupMenuItem<SubscriptionPlanId>(
                                          value: plan,
                                          child: Row(
                                            children: [
                                              Icon(
                                                Icons.workspace_premium_outlined,
                                                size: 18,
                                              ),
                                              const SizedBox(width: 10),
                                              Expanded(child: Text(plan.title)),
                                            ],
                                          ),
                                        );
                                      })
                                      .toList();
                                },
                                child: Icon(
                                  Icons.menu_open,
                                  color: _accentText(context),
                                ),
                              ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Text(
                          'Accuracy: ${_planConfidenceLabel(selectedPlan)}',
                          style: TextStyle(
                            color: _secondaryText(context),
                            fontSize: 14,
                            height: 1.5,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Expanded(
                        child: _DedicatedPlanScreen(
                          plan: selectedPlan,
                          billing: billing,
                          futurePredictions: _futurePredictions,
                          isAdmin: isAdmin,
                          onRefresh: _reload,
                          plans: widget.currentPlans,
                          showSummaryCard: false,
                          onSelectPlan: isAdmin
                              ? (plan) {
                                  setState(() {
                                    _selectedPlanOverride = plan;
                                  });
                                }
                              : null,
                        ),
                      ),
                    ],
                  )
                : SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                'Premium Plans',
                                style: TextStyle(
                                  color: _primaryText(context),
                                  fontSize: 28,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Choose a plan to subscribe. Each plan opens its own dedicated prediction screen after activation.',
                          style: TextStyle(
                            color: _secondaryText(context),
                            fontSize: 14,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: 18),
                        SizedBox(
                          height: 396,
                          child: _PlanCarousel(
                            plans: widget.currentPlans,
                            billing: billing,
                            compact: false,
                            onBuyPlan: (plan) => _buyPlan(context, plan),
                            onPageChanged: (plan) {
                              setState(() {
                                _selectedPlanOverride = plan;
                              });
                            },
                          ),
                        ),
                        const SizedBox(height: 18),
                        _planNotice(
                          context,
                          title: 'What you get',
                          body: _planBenefitLines(selectedPlan).join('\n'),
                        ),

                      ],
                    ),
                  ),
          ),
        );
      },
    );
  }

  Widget _buildPurchaseScreen({
    required BuildContext context,
    required GooglePlayBillingService billing,
    required SubscriptionPlanId purchasePlan,
    required SubscriptionPlanId? activePlan,
    required bool isAdmin,
  }) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final accentText = _accentText(context);
    final product = billing.productFor(purchasePlan);
    final priceText = billing.isLoading
        ? 'Loading price...'
        : product?.price ?? purchasePlan.fallbackPrice;
    final canPurchase = billing.isAvailable && !billing.isOwned(purchasePlan);

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Subscribe to ${purchasePlan.title}',
                  style: TextStyle(
                    color: primaryText,
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Back to plan',
                onPressed: activePlan == null
                    ? null
                    : () {
                        setState(() {
                          _selectedPlanOverride = activePlan;
                          _showPurchaseScreen = false;
                        });
                      },
                icon: Icon(Icons.arrow_back, color: accentText),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Review the plan and continue to payment when you are ready.',
            style: TextStyle(
              color: secondaryText,
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: _planGradientColors(purchasePlan, context),
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: _screenBorder(context)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x16000000),
                  blurRadius: 24,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        purchasePlan.title,
                        style: TextStyle(
                          color: primaryText,
                          fontSize: 24,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    if (isAdmin)
                      const Icon(Icons.admin_panel_settings, size: 20),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Price: $priceText',
                  style: TextStyle(
                    color: secondaryText,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 12),
                ..._planBenefitLines(purchasePlan).map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.check_circle,
                          size: 18,
                          color: accentText,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            line,
                            style: TextStyle(
                              color: primaryText,
                              fontSize: 14,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: canPurchase
                        ? () => _buyPlan(context, purchasePlan)
                        : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF00D4AA),
                      foregroundColor: const Color(0xFF07111F),
                    ),
                    child: Text(
                      canPurchase ? 'Continue to payment' : 'Already active',
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _planNotice(
            context,
            title: 'Active plan',
            body: activePlan == null
                ? 'You do not have an active paid plan yet.'
                : 'Your active plan is ${activePlan.title}. Use the menu to switch to another plan or go back to your current plan.',
          ),
        ],
      ),
    );
  }
}


class _DedicatedPlanScreen extends StatefulWidget {
  const _DedicatedPlanScreen({
    required this.plan,
    required this.billing,
    required this.futurePredictions,
    required this.isAdmin,
    required this.onRefresh,
    required this.plans,
    required this.showSummaryCard,
    this.onSelectPlan,
  });

  final SubscriptionPlanId plan;
  final GooglePlayBillingService billing;
  final Future<List<PredictionRecord>> futurePredictions;
  final bool isAdmin;
  final Future<void> Function() onRefresh;
  final List<SubscriptionPlanId> plans;
  final bool showSummaryCard;
  final void Function(SubscriptionPlanId plan)? onSelectPlan;

  @override
  State<_DedicatedPlanScreen> createState() => _DedicatedPlanScreenState();
}

class _DedicatedPlanScreenState extends State<_DedicatedPlanScreen> {
  final Set<String> _expandedSectionKeys = <String>{};

  void _toggleSection(String key) {
    setState(() {
      if (_expandedSectionKeys.contains(key)) {
        _expandedSectionKeys.remove(key);
      } else {
        _expandedSectionKeys.add(key);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final accentText = _accentText(context);

    return FutureBuilder<List<PredictionRecord>>(
      future: widget.futurePredictions,
      builder: (context, snapshot) {
        final predictions = snapshot.data ?? const <PredictionRecord>[];
        final filteredPredictions = predictions
            .where((prediction) => _predictionMatchesPlan(prediction, widget.plan))
            .toList();

        return RefreshIndicator(
          onRefresh: widget.onRefresh,
          color: const Color(0xFF00D4AA),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            children: [
              if (widget.showSummaryCard) ...[
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: _screenSurface(context, elevated: true),
                    borderRadius: BorderRadius.circular(22),
                    border: Border.all(color: _screenBorder(context)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              widget.plan.title,
                              style: TextStyle(
                                color: primaryText,
                                fontSize: 22,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          if (widget.onSelectPlan != null)
                            PopupMenuButton<SubscriptionPlanId>(
                              tooltip: 'Switch plan',
                              onSelected: widget.onSelectPlan,
                              itemBuilder: (context) => widget.plans
                                  .map(
                                    (item) => PopupMenuItem<SubscriptionPlanId>(
                                      value: item,
                                      child: Row(
                                        children: [
                                          Icon(
                                            item == widget.plan
                                                ? Icons.check_circle
                                                : Icons.swap_horiz,
                                            size: 18,
                                          ),
                                          const SizedBox(width: 10),
                                          Expanded(child: Text(item.title)),
                                        ],
                                      ),
                                    ),
                                  )
                                  .toList(),
                              child: Icon(Icons.more_vert, color: accentText),
                            ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Accuracy: ${_planConfidenceLabel(widget.plan)}',
                        style: TextStyle(color: secondaryText, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
              ],
              if (snapshot.connectionState == ConnectionState.waiting &&
                  predictions.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 32),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (snapshot.hasError)
                _planNotice(
                  context,
                  title: 'Unable to load predictions',
                  body: 'Pull to refresh and try again.',
                )
              else if (filteredPredictions.isEmpty)
                _planNotice(
                  context,
                  title: 'No predictions in this band',
                  body:
                      'There are no published picks that match ${_planConfidenceLabel(widget.plan)} right now.',
                )
              else
                ..._buildPlanPredictionWidgets(
                  filteredPredictions,
                  _expandedSectionKeys,
                  _toggleSection,
                ),
            ],
          ),
        );
      },
    );
  }
}

class PickedMatchesPage extends StatelessWidget {
  const PickedMatchesPage({
    super.key,
    required this.selectedPredictions,
    required this.onClearAll,
  });

  final List<PredictionRecord> selectedPredictions;
  final VoidCallback? onClearAll;

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final headerSurface = _screenSurface(context, elevated: true);
    final screenWidth = MediaQuery.sizeOf(context).width;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: _screenGradient(context),
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(0, 12, 0, 20),
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Picked Matches',
                      style: TextStyle(
                        color: _primaryText(context),
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  if (onClearAll != null)
                    TextButton.icon(
                      onPressed: onClearAll,
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('Clear'),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'All selected matches are arranged below in table form.',
                style: TextStyle(
                  color: _secondaryText(context),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 14),
            if (selectedPredictions.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: _EmptyState(
                  icon: Icons.fact_check_outlined,
                  title: 'No picked matches yet',
                  message: 'Select an unlocked match from Home to see it here.',
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 0),
                child: Container(
                  decoration: BoxDecoration(
                    color: surface,
                    borderRadius: BorderRadius.zero,
                    border: Border.symmetric(
                      vertical: BorderSide(color: border),
                    ),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: DataTable(
                        columnSpacing: 8,
                        horizontalMargin: 12,
                        headingRowHeight: 38,
                        dataRowMinHeight: 40,
                        dataRowMaxHeight: 56,
                        headingRowColor: WidgetStatePropertyAll(headerSurface),
                        dataRowColor: WidgetStatePropertyAll(surface),
                        columns: [
                          DataColumn(
                            label: Text(
                              'Time',
                              style: TextStyle(color: primaryText, fontSize: 11, fontWeight: FontWeight.w700),
                            ),
                          ),
                          DataColumn(
                            label: Text(
                              'Match',
                              style: TextStyle(color: primaryText, fontSize: 11, fontWeight: FontWeight.w700),
                            ),
                          ),
                          DataColumn(
                            label: Text(
                              'Conf',
                              style: TextStyle(color: primaryText, fontSize: 11, fontWeight: FontWeight.w700),
                            ),
                          ),
                          DataColumn(
                            label: Text(
                              'Pick',
                              style: TextStyle(color: primaryText, fontSize: 11, fontWeight: FontWeight.w700),
                            ),
                          ),
                        ],
                        rows: selectedPredictions.map((prediction) {
                          final cellStyle = TextStyle(
                            color: primaryText,
                            fontSize: 11,
                            height: 1.2,
                          );
                          return DataRow(
                            cells: [
                              DataCell(
                                Text(
                                  _formatTimeOnly(
                                    prediction.kickoffAt ?? prediction.releaseAt,
                                  ),
                                  style: cellStyle,
                                ),
                              ),
                              DataCell(
                                ConstrainedBox(
                                  constraints: BoxConstraints(
                                    maxWidth: screenWidth * 0.28,
                                  ),
                                  child: Text(
                                    '${prediction.homeTeamName ?? 'Home'} v ${prediction.awayTeamName ?? 'Away'}',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: cellStyle,
                                  ),
                                ),
                              ),
                              DataCell(
                                Text(
                                  _confidenceBadgeLabel(prediction)[0].toUpperCase(),
                                  style: cellStyle,
                                ),
                              ),
                              DataCell(
                                ConstrainedBox(
                                  constraints: BoxConstraints(
                                    maxWidth: screenWidth * 0.26,
                                  ),
                                  child: Text(
                                    _finalSelection(
                                      _PickCardData.fromPick(
                                        'Primary pick',
                                        prediction.primaryPick,
                                        const Color(0xFF00D4AA),
                                        prediction,
                                      ),
                                    ),
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: cellStyle,
                                  ),
                                ),
                              ),
                            ],
                          );
                        }).toList(),
                      ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PremiumUpgradeGate extends StatelessWidget {
  const _PremiumUpgradeGate({
    required this.isPremiumUser,
    required this.onOpenPremium,
  });

  final bool isPremiumUser;
  final VoidCallback onOpenPremium;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Premium only',
            style: TextStyle(
              color: primaryText,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            isPremiumUser
                ? 'High confidence picks are in your Premium screen.'
                : 'High confidence picks are available only to Premium users.',
            style: TextStyle(color: secondaryText, fontSize: 14, height: 1.5),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: onOpenPremium,
              child: Text(isPremiumUser ? 'Open Premium Plan' : 'Subscribe'),
            ),
          ),
        ],
      ),
    );
  }
}

class _SelectedMatchesBar extends StatelessWidget {
  const _SelectedMatchesBar({
    required this.count,
    required this.onOpenPicked,
    required this.onClear,
  });

  final int count;
  final VoidCallback onOpenPicked;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    return Material(
      color: surface,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              onPressed: onClear,
              child: const Text('Clear'),
            ),
            const SizedBox(width: 10),
            InkWell(
              onTap: onOpenPicked,
              borderRadius: BorderRadius.circular(999),
              child: Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFF00D4AA),
                  shape: BoxShape.circle,
                  border: Border.all(color: border),
                ),
                alignment: Alignment.center,
                child: Text(
                  '$count',
                  style: TextStyle(
                    color: const Color(0xFF07111F),
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubscriptionPlanCard extends StatelessWidget {
  const _SubscriptionPlanCard({
    required this.title,
    required this.price,
    required this.subtitle,
    required this.featureLines,
    required this.buttonLabel,
    required this.onPressed,
    required this.highlight,
  });

  final String title;
  final String price;
  final String subtitle;
  final List<String> featureLines;
  final String buttonLabel;
  final VoidCallback? onPressed;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context, elevated: true);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final accentText = _accentText(context);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: highlight ? surface : _screenSurface(context),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: highlight ? const Color(0xFF00D4AA) : border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: primaryText,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                price,
                style: TextStyle(
                  color: price == 'Active' ? const Color(0xFF00D4AA) : accentText,
                  fontSize: price == 'Active' ? 18 : 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(subtitle, style: TextStyle(color: secondaryText, fontSize: 13)),
          const SizedBox(height: 14),
          ...featureLines.map(
            (line) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(
                    Icons.check_circle,
                    size: 16,
                    color: Color(0xFF00D4AA),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      line,
                      style: TextStyle(color: primaryText, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: FilledButton(onPressed: onPressed, child: Text(buttonLabel)),
          ),
        ],
      ),
    );
  }
}

Widget _planNotice(
  BuildContext context, {
  required String title,
  required String body,
}) {
  // Build notices against the current theme so they remain readable in light mode.
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: _screenSurface(context),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _screenBorder(context)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: _primaryText(context),
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          body,
          style: TextStyle(
            color: _secondaryText(context),
            fontSize: 13,
            height: 1.45,
          ),
        ),
      ],
    ),
  );
}

String _normalizeFixtureApiId(String fixtureApiId) {
  return fixtureApiId.trim();
}

String _predictionUnlockKey(PredictionRecord prediction) {
  final recordId = prediction.recordId?.trim() ?? '';
  if (recordId.isNotEmpty) {
    return recordId;
  }
  return _normalizeFixtureApiId(prediction.fixtureApiId);
}

class _StickyHeader extends StatefulWidget {
  const _StickyHeader({
    required this.searchQuery,
    required this.onSearchChanged,
    required this.onClearSearch,
    required this.onOpenMenu,
  });

  final String searchQuery;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback? onClearSearch;
  final VoidCallback onOpenMenu;

  @override
  State<_StickyHeader> createState() => _StickyHeaderState();
}

class _StickyHeaderState extends State<_StickyHeader> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.searchQuery);
  }

  @override
  void didUpdateWidget(covariant _StickyHeader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.searchQuery != widget.searchQuery &&
        widget.searchQuery != _controller.text) {
      _controller.text = widget.searchQuery;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final border = _screenBorder(context);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFF00D4AA).withAlpha(24),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Icon(
            Icons.sports_soccer,
            color: _accentText(context),
            size: 20,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'AI Football Prediction',
                style: TextStyle(
                  color: primaryText,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  height: 1.0,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 6),
              Container(
                height: 38,
                decoration: BoxDecoration(
                  color: _screenSurface(context, elevated: true),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: border),
                ),
                child: TextField(
                  controller: _controller,
                  onChanged: widget.onSearchChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search picks, teams, leagues',
                    hintStyle: TextStyle(color: secondaryText, fontSize: 12),
                    prefixIcon: Icon(Icons.search, color: secondaryText, size: 18),
                    suffixIcon: widget.searchQuery.isEmpty
                        ? null
                        : IconButton(
                            tooltip: 'Clear search',
                            onPressed: widget.onClearSearch,
                            icon: Icon(Icons.close, color: secondaryText, size: 18),
                          ),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        IconButton(
          tooltip: 'Menu',
          onPressed: widget.onOpenMenu,
          icon: Icon(Icons.menu, color: _accentText(context)),
        ),
      ],
    );
  }
}


class _SearchResult {
  const _SearchResult({required this.query, required this.filter});
  final String query;
  final _ConfidenceFilter filter;
}

class _SearchModal extends StatefulWidget {
  const _SearchModal({
    required this.initialQuery,
    required this.initialFilter,
  });

  final String initialQuery;
  final _ConfidenceFilter initialFilter;

  @override
  State<_SearchModal> createState() => _SearchModalState();
}

class _SearchModalState extends State<_SearchModal> {
  late final TextEditingController _controller;
  late _ConfidenceFilter _filter;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialQuery);
    _filter = widget.initialFilter;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _apply() {
    Navigator.of(context).pop(
      _SearchResult(query: _controller.text, filter: _filter),
    );
  }

  void _clear() {
    _controller.clear();
    setState(() => _filter = _ConfidenceFilter.all);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final inputFill = _inputFill(context);
    final border = _screenBorder(context);
    return Align(
      alignment: Alignment.topCenter,
      child: Material(
        color: Colors.transparent,
        child: Container(
          margin: EdgeInsets.only(
            top: MediaQuery.of(context).padding.top,
            left: 12,
            right: 12,
          ),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF0D1B2D) : Colors.white,
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(28),
            ),
            border: Border.all(color: border),
            boxShadow: const [
              BoxShadow(
                color: Color(0x33000000),
                blurRadius: 24,
                offset: Offset(0, 12),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.search, color: _accentText(context), size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'Search & Filter',
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: _clear,
                    icon: Icon(Icons.clear_all, color: secondaryText, size: 20),
                    tooltip: 'Clear',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  const SizedBox(width: 8),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close, color: secondaryText, size: 20),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _controller,
                autofocus: true,
                onSubmitted: (_) => _apply(),
                style: TextStyle(color: primaryText),
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Teams, time...',
                  hintStyle: TextStyle(color: secondaryText),
                  prefixIcon: Icon(Icons.search, color: secondaryText),
                  filled: true,
                  fillColor: inputFill,
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xFF00D4AA)),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _ConfidenceFilter.values.map((f) {
                  final selected = f == _filter;
                  return ChoiceChip(
                    label: Text(f.label),
                    selected: selected,
                    onSelected: (_) => setState(() => _filter = f),
                    selectedColor: const Color(0xFF00D4AA),
                    labelStyle: TextStyle(
                      color: selected ? const Color(0xFF07111F) : primaryText,
                      fontWeight: FontWeight.w700,
                    ),
                    backgroundColor: inputFill,
                    side: BorderSide(color: border),
                  );
                }).toList(),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _apply,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF00D4AA),
                    foregroundColor: const Color(0xFF07111F),
                  ),
                  child: const Text(
                    'Apply',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlanCarousel extends StatefulWidget {
  const _PlanCarousel({
    required this.plans,
    required this.billing,
    required this.compact,
    required this.onBuyPlan,
    this.onPageChanged,
  });

  final List<SubscriptionPlanId> plans;
  final GooglePlayBillingService billing;
  final bool compact;
  final void Function(SubscriptionPlanId plan) onBuyPlan;
  final void Function(SubscriptionPlanId plan)? onPageChanged;

  @override
  State<_PlanCarousel> createState() => _PlanCarouselState();
}

class _PlanCarouselState extends State<_PlanCarousel> {
  late final PageController _controller;
  int _pageIndex = 0;

  @override
  void initState() {
    super.initState();
    _controller = PageController(
      viewportFraction: widget.compact ? 0.9 : 0.84,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.billing,
      builder: (context, _) {
        return Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: widget.plans.length,
                onPageChanged: (value) {
                  setState(() {
                    _pageIndex = value;
                  });
                  if (value < widget.plans.length) {
                    widget.onPageChanged?.call(widget.plans[value]);
                  }
                },
                itemBuilder: (context, index) {
                  final plan = widget.plans[index];
                  final product = widget.billing.productFor(plan);
                  final isOwned = widget.billing.isOwned(plan);
                  final canPurchase = widget.billing.isAvailable && !isOwned;
                  final String price;
                  if (isOwned) {
                    price = 'Active';
                  } else if (widget.billing.isLoading) {
                    price = '...';
                  } else {
                    price = product?.price ?? plan.fallbackPrice;
                  }
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: _CarouselPlanCard(
                      plan: plan,
                      price: price,
                      isOwned: isOwned,
                      compact: widget.compact,
                      onPressed: canPurchase ? () => widget.onBuyPlan(plan) : null,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(widget.plans.length, (index) {
                final selected = index == _pageIndex;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: selected ? 18 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: selected
                        ? const Color(0xFF00D4AA)
                        : _screenBorder(context).withAlpha(180),
                    borderRadius: BorderRadius.circular(999),
                  ),
                );
              }),
            ),
          ],
        );
      },
    );
  }
}

class _CarouselPlanCard extends StatelessWidget {
  const _CarouselPlanCard({
    required this.plan,
    required this.price,
    required this.isOwned,
    required this.compact,
    required this.onPressed,
  });

  final SubscriptionPlanId plan;
  final String price;
  final bool isOwned;
  final bool compact;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final border = _screenBorder(context);
    final colors = _planGradientColors(plan, context);
    final accent = _planAccentColor(plan);
    final benefits = _planBenefitLines(plan);
    final badge = switch (plan) {
      SubscriptionPlanId.weeklyAdFree => 'Best quick win',
      SubscriptionPlanId.basic => 'Starter access',
      SubscriptionPlanId.standard => 'Balanced pick',
      SubscriptionPlanId.premium => 'Full access',
    };

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: colors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: border.withAlpha(120)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x18000000),
            blurRadius: 20,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -26,
            top: -18,
            child: Container(
              width: 110,
              height: 110,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withAlpha(16),
              ),
            ),
          ),
          Positioned(
            right: 10,
            bottom: 8,
            child: Container(
              width: 74,
              height: 74,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white.withAlpha(10),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.white.withAlpha(22),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        badge,
                        style: TextStyle(
                          color: primaryText,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const Spacer(),
                    Icon(
                      isOwned ? Icons.verified : Icons.auto_awesome,
                      color: accent,
                      size: 20,
                    ),
                  ],
                ),
                const Spacer(),
                Text(
                  plan.title,
                  style: TextStyle(
                    color: primaryText,
                    fontSize: compact ? 22 : 26,
                    fontWeight: FontWeight.w900,
                    height: 1.0,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  plan.subtitle,
                  style: TextStyle(
                    color: secondaryText.withAlpha(230),
                    fontSize: compact ? 13 : 14,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: benefits
                      .take(compact ? 2 : 3)
                      .map((benefit) => _PlanBenefitLine(text: benefit))
                      .toList(),
                ),
                const Spacer(),
                Row(
                  children: [
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            price,
                            style: TextStyle(
                              color: primaryText,
                              fontSize: compact ? 18 : 22,
                              fontWeight: FontWeight.w900,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            isOwned ? 'Active' : 'One tap',
                            style: TextStyle(
                              color: secondaryText.withAlpha(235),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: onPressed,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF00D4AA),
                        foregroundColor: const Color(0xFF07111F),
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                      ),
                      child: Text(
                        isOwned
                            ? 'Active'
                            : onPressed == null
                                ? 'Unavailable'
                                : 'Subscribe',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PlanBenefitLine extends StatelessWidget {
  const _PlanBenefitLine({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: const Color(0xFF00D4AA).withAlpha(28),
            borderRadius: BorderRadius.circular(999),
          ),
          child: const Icon(Icons.check, size: 12, color: Color(0xFF00D4AA)),
        ),
        const SizedBox(width: 8),
        Text(
          text,
          style: TextStyle(
            color: primaryText,
            fontSize: 13,
            fontWeight: FontWeight.w600,
            height: 1.3,
          ),
        ),
      ],
    );
  }
}

class PolicyPage extends StatelessWidget {
  const PolicyPage({super.key});

  static const String _policyUrl =
      'https://www.e-droid.net/privacy.php?ida=4037981&idl=en';

  Future<void> _openPolicyUrl() async {
    final uri = Uri.parse(_policyUrl);
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final appBarColor = isDark
        ? const Color(0xFF0A1220)
        : const Color(0xFFF8FAFD);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Policy'), backgroundColor: appBarColor),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Privacy and App Policy',
            style: TextStyle(
              color: primaryText,
              fontSize: 24,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'This app provides football prediction content only. It does not encourage, promote, or require users to place bets. Any betting decision is entirely the user\'s responsibility and should only be made where it is legal and appropriate to do so. The app is for informational and entertainment purposes.',
            style: TextStyle(color: secondaryText, fontSize: 14, height: 1.5),
          ),
          const SizedBox(height: 20),
          _policySection(
            context,
            title: 'Important notice',
            body:
                'The app does not guarantee winnings, outcomes, or financial profit. Predictions are based on available data and should be treated as opinions, not certainty.',
          ),
          const SizedBox(height: 12),
          _policySection(
            context,
            title: 'Age and responsibility',
            body:
                'Users should comply with local laws and age restrictions. If gambling is restricted in your location or if you are under the legal age, do not use the app for betting-related activity.',
          ),
          const SizedBox(height: 12),
          _policySection(
            context,
            title: 'Data use',
            body:
                'The app may use account, notification, and analytics-related services needed to deliver predictions and alerts. We do not sell user betting choices or ask for payment to access basic prediction content.',
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _openPolicyUrl,
            icon: const Icon(Icons.open_in_new),
            label: const Text('Open web policy'),
          ),
          const SizedBox(height: 8),
          Text(
            'Web policy source:',
            style: TextStyle(
              color: secondaryText,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          SelectableText(
            _policyUrl,
            style: TextStyle(color: _accentText(context), fontSize: 13),
          ),
          const SizedBox(height: 28),
          const Center(child: _PolicyPageStateful()),
        ],
      ),
    );
  }
}

class _PolicyPageStateful extends StatefulWidget {
  const _PolicyPageStateful();

  @override
  State<_PolicyPageStateful> createState() => _PolicyPageStatefulState();
}

class _PolicyPageStatefulState extends State<_PolicyPageStateful> {
  int _tapCount = 0;
  Timer? _resetTimer;

  @override
  void dispose() {
    _resetTimer?.cancel();
    super.dispose();
  }

  void _registerTap() {
    _resetTimer?.cancel();
    setState(() {
      _tapCount += 1;
    });

    if (_tapCount >= 3) {
      _tapCount = 0;
      _promptPassword();
      return;
    }

    _resetTimer = Timer(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _tapCount = 0;
        });
      }
    });
  }

  Future<void> _promptPassword() async {
    final controller = TextEditingController();
    final password = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Admin Access'),
          content: TextField(
            controller: controller,
            obscureText: true,
            decoration: const InputDecoration(hintText: 'Enter password'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(controller.text),
              child: const Text('Unlock'),
            ),
          ],
        );
      },
    );

    controller.dispose();
    if (password == null || password.isEmpty) {
      return;
    }

    final ok = await AdminAccessService.instance.unlock(password);
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Admin access unlocked for this device.' : 'Incorrect password.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AdminAccessService.instance,
      builder: (context, _) {
        final isAdmin = AdminAccessService.instance.isAdmin;
        final surface = _screenSurface(context);
        final border = _screenBorder(context);
        final accentText = _accentText(context);
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            GestureDetector(
              onTap: _registerTap,
              child: Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: surface,
                  shape: BoxShape.circle,
                  border: Border.all(color: border),
                ),
                child: Center(
                  child: Text(
                    'thgir llA',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: accentText.withAlpha(150),
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
            if (isAdmin) ...[
              const SizedBox(width: 12),
              GestureDetector(
                onTap: () async {
                  if (!context.mounted) {
                    return;
                  }
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Admin access revoked for this device.'),
                    ),
                  );
                },
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: surface,
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFFF6B6B)),
                  ),
                  child: Icon(
                    Icons.logout,
                    size: 18,
                    color: const Color(0xFFFF6B6B),
                  ),
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

Widget _policySection(
  BuildContext context, {
  required String title,
  required String body,
}) {
  final surface = _screenSurface(context);
  final border = _screenBorder(context);
  final primaryText = _primaryText(context);
  final secondaryText = _secondaryText(context);
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: surface,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: primaryText,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          body,
          style: TextStyle(color: secondaryText, fontSize: 14, height: 1.5),
        ),
      ],
    ),
  );
}

class _PredictionDateSection {
  const _PredictionDateSection({
    required this.date,
    required this.label,
    required this.keyValue,
    required this.predictions,
  });

  final DateTime date;
  final String label;
  final String keyValue;
  final List<PredictionRecord> predictions;
}

List<Widget> _buildGroupedPredictionWidgets(
  BuildContext buildContext,
  List<PredictionRecord> predictions,
  Set<String> expandedSectionKeys,
  void Function(String key) onToggleSection,
  _TodayBucket selectedTodayBucket,
  void Function(_TodayBucket bucket) onSelectTodayBucket,
  bool Function(String fixtureApiId) isPickUnlocked,
  Future<void> Function(PredictionRecord prediction) onUnlockPick,
  String? unlockingPickKey,
  bool adFree,
  bool Function(PredictionRecord prediction) isSelected,
  void Function(PredictionRecord prediction) onToggleSelection,
  Future<void> Function(PredictionRecord prediction) onOpenComments,
  bool showAds,
) {
  final sections = _groupPredictionsByDate(predictions);
  final widgets = <Widget>[];
  const horizontalPadding = EdgeInsets.symmetric(horizontal: 20);

  for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    final section = sections[sectionIndex];
    final isTodaySection = section.label == 'Today';
    final isExpanded =
        isTodaySection || expandedSectionKeys.contains(section.keyValue);

    if (sectionIndex > 0) {
      widgets.add(const SizedBox(height: 20));
    }

    widgets.add(
      Padding(
        padding: horizontalPadding,
        child: _DateSectionHeader(
          label: section.label,
          count: section.predictions.length,
          isExpanded: isExpanded,
          canToggle: !isTodaySection,
          onTap: () => onToggleSection(section.keyValue),
        ),
      ),
    );
    if (!isExpanded) {
      continue;
    }

    widgets.add(SizedBox(height: isTodaySection ? 8 : 12));

    if (isTodaySection) {
      widgets.addAll(
        _buildTodayStatusWidgets(
          section.predictions,
          selectedTodayBucket,
          onSelectTodayBucket,
          isPickUnlocked,
          onUnlockPick,
          unlockingPickKey,
          adFree,
          isSelected,
          onToggleSelection,
          onOpenComments,
          showAds,
        ),
      );
      continue;
    }

    for (var i = 0; i < section.predictions.length; i++) {
      final prediction = section.predictions[i];
      widgets.add(
        Padding(
          padding: horizontalPadding,
            child: PredictionGroupCard(
              prediction: prediction,
              isLocked: !isPickUnlocked(_predictionUnlockKey(prediction)),
              isUnlocking: unlockingPickKey == _predictionUnlockKey(prediction),
              onUnlockPressed: () => onUnlockPick(prediction),
              isSelected: isSelected(prediction),
              canSelect:
                  (adFree || isPickUnlocked(_predictionUnlockKey(prediction))) &&
                  !_isFinishedPrediction(prediction, DateTime.now().toLocal()),
              onSelectionPressed: () => onToggleSelection(prediction),
              onOpenComments: () => onOpenComments(prediction),
            ),
          ),
      );
      if (i < section.predictions.length - 1) {
        widgets.add(const SizedBox(height: 12));
        if (showAds) {
          widgets.add(const FeedBannerAd());
        }
        widgets.add(const SizedBox(height: 12));
      }
    }
  }

  return widgets;
}

enum _TodayBucket { coming, live, finished }

List<Widget> _buildTodayStatusWidgets(
  List<PredictionRecord> predictions,
  _TodayBucket selectedBucket,
  void Function(_TodayBucket bucket) onSelectBucket,
  bool Function(String fixtureApiId) isPickUnlocked,
  Future<void> Function(PredictionRecord prediction) onUnlockPick,
  String? unlockingPickKey,
  bool adFree,
  bool Function(PredictionRecord prediction) isSelected,
  void Function(PredictionRecord prediction) onToggleSelection,
  Future<void> Function(PredictionRecord prediction) onOpenComments,
  bool showAds,
) {
  final now = DateTime.now();
  final grouped = <_TodayBucket, List<PredictionRecord>>{
    _TodayBucket.coming: <PredictionRecord>[],
    _TodayBucket.live: <PredictionRecord>[],
    _TodayBucket.finished: <PredictionRecord>[],
  };

  final sortedPredictions = [...predictions]
    ..sort(_comparePredictionsByKickoff);

  for (final prediction in sortedPredictions) {
    final bucket = _todayBucketForPrediction(prediction, now);
    grouped[bucket]!.add(prediction);
  }

  final widgets = <Widget>[];
  final selectedItems = grouped[selectedBucket] ?? const <PredictionRecord>[];

  widgets.add(
    Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: _TodayCategorySelector(
        selectedBucket: selectedBucket,
        counts: {
          for (final bucket in _TodayBucket.values)
            bucket: grouped[bucket]?.length ?? 0,
        },
        onSelectBucket: onSelectBucket,
      ),
    ),
  );
  widgets.add(const SizedBox(height: 10));

  if (selectedItems.isEmpty) {
    widgets.add(
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
        child: Text(
          'No matches in this category.',
          style: TextStyle(
            color: const Color(0xFF52657A),
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
    return widgets;
  }

  for (var i = 0; i < selectedItems.length; i++) {
    final prediction = selectedItems[i];
    widgets.add(
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: PredictionGroupCard(
          prediction: prediction,
          isLocked: !isPickUnlocked(_predictionUnlockKey(prediction)),
          isUnlocking: unlockingPickKey == _predictionUnlockKey(prediction),
          onUnlockPressed: () => onUnlockPick(prediction),
          isSelected: isSelected(prediction),
          canSelect:
              (adFree || isPickUnlocked(_predictionUnlockKey(prediction))) &&
              !_isFinishedPrediction(prediction, DateTime.now().toLocal()),
          onSelectionPressed: () => onToggleSelection(prediction),
          onOpenComments: () => onOpenComments(prediction),
        ),
      ),
    );
    if (i < selectedItems.length - 1) {
      widgets.add(const SizedBox(height: 12));
      if (showAds) {
        widgets.add(const FeedBannerAd());
      }
      widgets.add(const SizedBox(height: 12));
    }
  }

  return widgets;
}

List<Widget> _buildPlanPredictionWidgets(
  List<PredictionRecord> predictions,
  Set<String> expandedSectionKeys,
  void Function(String key) onToggleSection,
) {
  final sections = _groupPredictionsByDate(predictions);
  final widgets = <Widget>[];

  for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    final section = sections[sectionIndex];
    final isTodaySection = section.label == 'Today';
    final isExpanded =
        isTodaySection || expandedSectionKeys.contains(section.keyValue);
    if (sectionIndex > 0) {
      widgets.add(const SizedBox(height: 20));
    }

    widgets.add(
      _DateSectionHeader(
        label: section.label,
        count: section.predictions.length,
        isExpanded: isExpanded,
        canToggle: !isTodaySection,
        onTap: () => onToggleSection(section.keyValue),
      ),
    );
    if (!isExpanded) {
      continue;
    }

    widgets.add(const SizedBox(height: 12));

    for (var i = 0; i < section.predictions.length; i++) {
      final prediction = section.predictions[i];
      widgets.add(
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 0),
          child: PredictionGroupCard(
            prediction: prediction,
            isLocked: false,
            isUnlocking: false,
            onUnlockPressed: () {},
            isSelected: false,
            canSelect: false,
            onSelectionPressed: () {},
          ),
        ),
      );
      if (i < section.predictions.length - 1) {
        widgets.add(const SizedBox(height: 12));
      }
    }
  }

  return widgets;
}

String _todayBucketLabel(_TodayBucket bucket) {
  switch (bucket) {
    case _TodayBucket.coming:
      return 'Upcoming';
    case _TodayBucket.live:
      return 'Live now';
    case _TodayBucket.finished:
      return 'Finished';
  }
}

_TodayBucket _todayBucketForPrediction(
  PredictionRecord prediction,
  DateTime now,
) {
  if (_isFinishedPrediction(prediction, now)) {
    return _TodayBucket.finished;
  }
  if (_isLivePrediction(prediction)) {
    return _TodayBucket.live;
  }
  return _TodayBucket.coming;
}

bool _isLivePrediction(PredictionRecord prediction) {
  final statusShort = prediction.matchStatusShort?.toUpperCase();
  final statusLong = prediction.matchStatusLong?.toLowerCase() ?? '';
  final kickoffAt = _localDateTime(prediction.kickoffAt);
  final now = DateTime.now().toLocal();

  if (kickoffAt != null && now.isBefore(kickoffAt)) {
    return false;
  }

  const liveStatuses = {
    '1H',
    'HT',
    '2H',
    'ET',
    'BT',
    'LIVE',
    'INT',
    'P',
    'PEN',
    'SUSP',
  };

  if (statusShort != null && liveStatuses.contains(statusShort)) {
    return true;
  }

  if (statusLong.contains('live') || statusLong.contains('in play')) {
    return true;
  }

  if (kickoffAt != null) {
    final liveStart = kickoffAt;
    final liveEnd = kickoffAt.add(const Duration(minutes: 90));
    if (now.isAfter(liveStart) && now.isBefore(liveEnd)) {
      return true;
    }
  }

  return false;
}

bool _isFinishedPrediction(PredictionRecord prediction, DateTime now) {
  final statusShort = prediction.matchStatusShort?.toUpperCase();
  final statusLong = prediction.matchStatusLong?.toLowerCase() ?? '';
  const finishedStatuses = {'FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'};

  if (statusShort != null && finishedStatuses.contains(statusShort)) {
    return true;
  }

  if (statusLong.contains('finished') || statusLong.contains('full time')) {
    return true;
  }

  final kickoffAt = _localDateTime(prediction.kickoffAt);
  if (kickoffAt != null) {
    final finishedCutoff = kickoffAt.add(const Duration(minutes: 90));
    if (now.isAfter(finishedCutoff)) {
      return true;
    }
  }

  return prediction.fulltimeHomeGoals != null ||
      prediction.fulltimeAwayGoals != null;
}

class _TodayCategorySelector extends StatelessWidget {
  const _TodayCategorySelector({
    required this.selectedBucket,
    required this.counts,
    required this.onSelectBucket,
  });

  final _TodayBucket selectedBucket;
  final Map<_TodayBucket, int> counts;
  final void Function(_TodayBucket bucket) onSelectBucket;

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final barBg = isDark ? const Color(0xFF121B2E) : const Color(0xFFE8EEF5);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    final items = _TodayBucket.values.map((bucket) {
      final isSelected = bucket == selectedBucket;
      final count = counts[bucket] ?? 0;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelectBucket(bucket),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeInOut,
            padding: const EdgeInsets.symmetric(vertical: 8),
            decoration: BoxDecoration(
              color: isSelected ? const Color(0xFF00D4AA) : Colors.transparent,
              borderRadius: BorderRadius.circular(14),
              boxShadow: isSelected
                  ? [
                      BoxShadow(
                        color: const Color(0xFF00D4AA).withAlpha(60),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      )
                    ]
                  : null,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _todayBucketLabel(bucket),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: isSelected ? const Color(0xFF0A0F1E) : primaryText,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? const Color(0xFF0A0F1E).withAlpha(30)
                        : (isDark ? const Color(0xFF1E293B) : const Color(0xFFDFE6F0)),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      color: isSelected ? const Color(0xFF0A0F1E) : secondaryText,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }).toList();

    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: barBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: Row(children: items),
    );
  }
}

bool _isComingPrediction(PredictionRecord prediction, DateTime now) {
  final kickoffAt = _localDateTime(prediction.kickoffAt);
  if (kickoffAt == null) {
    return true;
  }
  return kickoffAt.isAfter(now);
}

List<_PredictionDateSection> _groupPredictionsByDate(
  List<PredictionRecord> predictions,
) {
  final now = DateTime.now().toLocal();
  final grouped = <DateTime, List<PredictionRecord>>{};

  final sortedPredictions = [...predictions]
    ..sort(_comparePredictionsByKickoff);

  for (final prediction in sortedPredictions) {
    final dateKey = _predictionDateKey(prediction);
    grouped.putIfAbsent(dateKey, () => <PredictionRecord>[]).add(prediction);
  }

  final keys = grouped.keys.toList()
    ..sort((left, right) => _compareSectionDates(left, right, now));

  return keys.map((date) {
    final items = grouped[date]!..sort(_comparePredictionsByKickoff);
    return _PredictionDateSection(
      date: date,
      label: _predictionDateLabel(date, now),
      keyValue: date.toIso8601String(),
      predictions: items,
    );
  }).toList();
}

DateTime _predictionDateKey(PredictionRecord prediction) {
  final source =
      prediction.kickoffAt ??
      prediction.publishedAt ??
      prediction.releaseAt ??
      DateTime.now();
  final local = source.toLocal();
  return DateTime(local.year, local.month, local.day);
}

String _predictionDateLabel(DateTime date, DateTime now) {
  final diff = _dateOnly(date).difference(_dateOnly(now)).inDays;

  if (diff == 0) {
    return 'Today';
  }
  if (diff == 1) {
    return 'Tomorrow';
  }
  if (diff == -1) {
    return 'Yesterday';
  }
  if (diff.abs() <= 6) {
    return _weekdayName(date.weekday);
  }

  return _formatSectionDate(date);
}

int _compareSectionDates(DateTime left, DateTime right, DateTime now) {
  final leftPriority = _datePriority(left, now);
  final rightPriority = _datePriority(right, now);

  if (leftPriority != rightPriority) {
    return leftPriority.compareTo(rightPriority);
  }

  if (leftPriority == 2) {
    return left.compareTo(right);
  }

  if (leftPriority == 4) {
    return right.compareTo(left);
  }

  return left.compareTo(right);
}

int _datePriority(DateTime date, DateTime now) {
  final diff = _dateOnly(date).difference(_dateOnly(now)).inDays;
  if (diff == 0) {
    return 0;
  }
  if (diff == 1) {
    return 1;
  }
  if (diff > 1) {
    return 2;
  }
  if (diff == -1) {
    return 3;
  }
  return 4;
}

DateTime _dateOnly(DateTime value) {
  final local = value.toLocal();
  return DateTime(local.year, local.month, local.day);
}

String _weekdayName(int weekday) {
  switch (weekday) {
    case DateTime.monday:
      return 'Monday';
    case DateTime.tuesday:
      return 'Tuesday';
    case DateTime.wednesday:
      return 'Wednesday';
    case DateTime.thursday:
      return 'Thursday';
    case DateTime.friday:
      return 'Friday';
    case DateTime.saturday:
      return 'Saturday';
    case DateTime.sunday:
      return 'Sunday';
    default:
      return 'Unknown';
  }
}

String _formatSectionDate(DateTime value) {
  final local = value.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  return '$month/$day/${local.year}';
}

int _comparePredictionsByKickoff(
  PredictionRecord left,
  PredictionRecord right,
) {
  final leftKickoff = _localDateTime(
    left.kickoffAt ?? left.publishedAt ?? left.releaseAt,
  );
  final rightKickoff = _localDateTime(
    right.kickoffAt ?? right.publishedAt ?? right.releaseAt,
  );

  if (leftKickoff == null && rightKickoff == null) {
    return left.fixtureApiId.compareTo(right.fixtureApiId);
  }
  if (leftKickoff == null) {
    return 1;
  }
  if (rightKickoff == null) {
    return -1;
  }

  final comparison = leftKickoff.toUtc().compareTo(rightKickoff.toUtc());
  if (comparison != 0) {
    return comparison;
  }

  return left.fixtureApiId.compareTo(right.fixtureApiId);
}

DateTime? _localDateTime(DateTime? value) {
  if (value == null) {
    return null;
  }

  return value.toLocal();
}

class _DateSectionHeader extends StatelessWidget {
  const _DateSectionHeader({
    required this.label,
    required this.count,
    required this.isExpanded,
    required this.canToggle,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool isExpanded;
  final bool canToggle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final accentText = _accentText(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: surface,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: canToggle ? onTap : null,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: border),
            ),
            child: Row(
              children: [
                Container(
                  width: 4,
                  height: 18,
                  decoration: BoxDecoration(
                    color: const Color(0xFF00D4AA),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF00D4AA).withAlpha(24),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: const Color(0xFF00D4AA).withAlpha(50)),
                  ),
                  child: Text(
                    '$count',
                    style: TextStyle(
                      color: accentText,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (canToggle)
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: accentText,
                    size: 20,
                  )
                else
                  Icon(Icons.push_pin, color: accentText, size: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class PredictionGroupCard extends StatelessWidget {
  const PredictionGroupCard({
    super.key,
    required this.prediction,
    required this.isLocked,
    required this.isUnlocking,
    required this.onUnlockPressed,
    required this.isSelected,
    required this.canSelect,
    required this.onSelectionPressed,
    this.onOpenComments,
    this.isPopular,
  });

  final PredictionRecord prediction;
  final bool isLocked;
  final bool isUnlocking;
  final VoidCallback onUnlockPressed;
  final bool isSelected;
  final bool canSelect;
  final VoidCallback onSelectionPressed;
  final VoidCallback? onOpenComments;
  final bool? isPopular;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final popular = isPopular ?? _isPopularPrediction(prediction);
    final primaryPick = _PickCardData.fromPick(
      'Primary pick',
      prediction.primaryPick,
      const Color(0xFF00D4AA),
      prediction,
    );

    final verdict = _pickVerdict(prediction);
    final isDark = _isDarkContext(context);
    final cardColor = switch (verdict) {
      _PickVerdict.correct => isDark ? const Color(0xFF0A2E1A) : const Color(0xFFE8F8EF),
      _PickVerdict.wrong   => isDark ? const Color(0xFF2E0A0A) : const Color(0xFFFFF0F0),
      _PickVerdict.pending => surface,
    };
    final cardBorder = switch (verdict) {
      _PickVerdict.correct => const Color(0xFF00C853),
      _PickVerdict.wrong   => const Color(0xFFFF5252),
      _PickVerdict.pending => isSelected || popular ? const Color(0xFF00D4AA) : border,
    };

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        color: cardColor,
        border: Border.all(color: cardBorder, width: verdict != _PickVerdict.pending || isSelected || popular ? 1.5 : 1.0),
        boxShadow: [
          if (verdict == _PickVerdict.correct)
            BoxShadow(color: const Color(0xFF00C853).withValues(alpha: 0.15), blurRadius: 18, offset: const Offset(0, 8))
          else if (verdict == _PickVerdict.wrong)
            BoxShadow(color: const Color(0xFFFF5252).withValues(alpha: 0.12), blurRadius: 18, offset: const Offset(0, 8))
          else if (popular)
            BoxShadow(
              color: const Color(0xFF00D4AA).withValues(alpha: 0.12),
              blurRadius: 18,
              offset: const Offset(0, 8),
            )
          else
            const BoxShadow(
              color: Color(0x1A000000),
              blurRadius: 16,
              offset: Offset(0, 8),
            ),
        ],
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _MatchHeader(
                  prediction: prediction,
                  isPopularOverride: popular,
                  homeScore: _teamScoreLabel(
                    prediction.currentHomeGoals,
                    prediction.fulltimeHomeGoals,
                  ),
                  awayScore: _teamScoreLabel(
                    prediction.currentAwayGoals,
                    prediction.fulltimeAwayGoals,
                  ),
                  confidenceLabel: _confidenceBadgeLabel(prediction),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _MetaChip(
                      icon: Icons.schedule,
                      iconColor: Colors.blueAccent,
                      label: _formatTimeOnly(
                        prediction.kickoffAt ?? prediction.releaseAt,
                      ),
                    ),
                    _MetaChip(
                      icon: _matchStatusIcon(prediction),
                      iconColor: _matchStatusLabel(prediction) == 'Live' ? Colors.redAccent : Colors.orangeAccent,
                      label: _matchStatusLabel(prediction),
                    ),
                    if (prediction.predictedWinner != null)
                      _MetaChip(
                        icon: Icons.flag,
                        iconColor: const Color(0xFF00D4AA),
                        label: prediction.predictedWinner!,
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 220),
                  child: isLocked
                      ? _LockedPickGate(
                          key: const ValueKey('locked'),
                          isUnlocking: isUnlocking,
                          onUnlockPressed: onUnlockPressed,
                        )
                      : _PickCard(
                          key: const ValueKey('unlocked'),
                          data: primaryPick,
                        ),
                ),
                if (canSelect && !isFinishedPrediction(prediction, DateTime.now().toLocal())) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.tonalIcon(
                      onPressed: onSelectionPressed,
                      style: FilledButton.styleFrom(
                        backgroundColor: isSelected
                            ? const Color(0xFF00D4AA).withAlpha(35)
                            : null,
                        foregroundColor: isSelected
                            ? const Color(0xFF00D4AA)
                            : null,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      icon: Icon(
                        isSelected ? Icons.check_circle : Icons.add_circle_outline,
                        size: 18,
                      ),
                      label: Text(
                        isSelected ? 'Selected' : 'Select Match',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                      ),
                    ),
                  ),
                ],
                if (!isLocked && onOpenComments != null) ...[
                  const SizedBox(height: 14),
                  _PredictionSocialSection(
                    prediction: prediction,
                    onOpenComments: onOpenComments!,
                  ),
                ],
              ],
            ),
          ),
          if (popular)
            Positioned(
              right: 14,
              top: 14,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: const Color(0xFF00D4AA).withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF00D4AA).withValues(alpha: 0.4),
                      blurRadius: 8,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.whatshot,
                  color: Color(0xFF00D4AA),
                  size: 16,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PredictionSocialSection extends StatelessWidget {
  const _PredictionSocialSection({
    required this.prediction,
    required this.onOpenComments,
  });

  final PredictionRecord prediction;
  final VoidCallback onOpenComments;

  @override
  Widget build(BuildContext context) {
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    return StreamBuilder<PredictionSocialSnapshot>(
      stream: SocialEngagementService.instance.watchPrediction(prediction.fixtureApiId),
      builder: (context, snapshot) {
        final counts = snapshot.data?.selectionCounts ?? const <String, int>{};
        final comments = snapshot.data?.comments ?? const <PredictionComment>[];
        final topCounts = counts.entries.toList()
          ..sort((a, b) => b.value.compareTo(a.value));

        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: _screenSurface(context, elevated: true),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: border),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Community',
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: topCounts.isEmpty
                        ? [
                            _TinyVerdictChip(
                              label: 'No votes yet',
                              color: _secondaryText(context),
                            ),
                          ]
                        : topCounts.take(3).map((entry) {
                            return _TinyVerdictChip(
                              label: '${entry.key} ${entry.value}',
                              color: const Color(0xFF00D4AA),
                            );
                          }).toList(),
                  ),
                ],
              ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '${comments.length}',
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    'comments',
                    style: TextStyle(
                      color: secondaryText,
                      fontSize: 10,
                    ),
                  ),
                  TextButton(
                    onPressed: onOpenComments,
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 0),
                      minimumSize: const Size(0, 28),
                    ),
                    child: const Text('Open'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

Future<void> showPredictionCommentsSheet(
  BuildContext context,
  PredictionRecord prediction,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) {
      return _PredictionCommentsSheet(prediction: prediction);
    },
  );
}

class _PredictionCommentsSheet extends StatefulWidget {
  const _PredictionCommentsSheet({required this.prediction});

  final PredictionRecord prediction;

  @override
  State<_PredictionCommentsSheet> createState() => _PredictionCommentsSheetState();
}

class _PredictionCommentsSheetState extends State<_PredictionCommentsSheet> {
  final TextEditingController _commentController = TextEditingController();

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submitComment() async {
    final text = _commentController.text.trim();
    if (text.isEmpty) {
      return;
    }

    await SocialEngagementService.instance.addComment(
      fixtureApiId: widget.prediction.fixtureApiId,
      message: text,
      selection: widget.prediction.primaryPick?.selection,
    );

    if (!mounted) {
      return;
    }

    _commentController.clear();
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final mediaQuery = MediaQuery.of(context);

    return Container(
      margin: EdgeInsets.only(bottom: mediaQuery.viewInsets.bottom),
      decoration: BoxDecoration(
        color: _screenSurface(context),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: _screenBorder(context),
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                '${widget.prediction.homeTeamName ?? 'Home'} vs ${widget.prediction.awayTeamName ?? 'Away'}',
                style: TextStyle(
                  color: primaryText,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Comments and selection chat',
                style: TextStyle(color: secondaryText, fontSize: 12),
              ),
              const SizedBox(height: 14),
              SizedBox(
                height: 280,
                child: StreamBuilder<PredictionSocialSnapshot>(
                  stream: SocialEngagementService.instance.watchPrediction(widget.prediction.fixtureApiId),
                  builder: (context, snapshot) {
                    final comments = snapshot.data?.comments ?? const <PredictionComment>[];
                    if (comments.isEmpty) {
                      return Center(
                        child: Text(
                          'No comments yet.',
                          style: TextStyle(color: secondaryText),
                        ),
                      );
                    }

                    return ListView.separated(
                      itemCount: comments.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final comment = comments[index];
                        return Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: _screenSurface(context, elevated: true),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: _screenBorder(context)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      comment.userName,
                                      style: TextStyle(
                                        color: primaryText,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                  if (comment.selection != null && comment.selection!.isNotEmpty)
                                    Text(
                                      comment.selection!,
                                      style: TextStyle(
                                        color: _accentText(context),
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(
                                comment.message,
                                style: TextStyle(
                                  color: secondaryText,
                                  height: 1.4,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _commentController,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'Write a comment...',
                  filled: true,
                  fillColor: _inputFill(context),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: _screenBorder(context)),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _submitComment,
                  child: const Text('Post comment'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Widget _teamBadge({
  required BuildContext context,
  required String? logoUrl,
  required String? teamName,
  required bool isHome,
  required String? scoreText,
}) {
  final displayName = (teamName?.trim().isNotEmpty ?? false)
      ? teamName!.trim()
      : (isHome ? 'Home team' : 'Away team');

  final initials = displayName
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty)
      .take(2)
      .map((part) => part[0])
      .join()
      .toUpperCase();

  final isDark = _isDarkContext(context);
  final avatarBg = isDark
      ? const Color(0xFF1E293B)
      : const Color(0xFFE2E8F0);
  final primaryText = _primaryText(context);

  return Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: avatarBg,
          shape: BoxShape.circle,
          border: Border.all(color: _screenBorder(context).withAlpha(120), width: 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: (logoUrl != null && logoUrl.isNotEmpty)
            ? Image.network(
                logoUrl,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isDark
                            ? const [Color(0xFF1E293B), Color(0xFF0F172A)]
                            : const [Color(0xFFE2E8F0), Color(0xFFCBD5E1)],
                      ),
                    ),
                    child: Center(
                      child: Text(
                        initials.isEmpty ? (isHome ? 'H' : 'A') : initials,
                        style: TextStyle(
                          color: primaryText.withValues(alpha: 0.55),
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  );
                },
                errorBuilder: (_, __, ___) => Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: isDark
                          ? const [Color(0xFF1E293B), Color(0xFF0F172A)]
                          : const [Color(0xFFE2E8F0), Color(0xFFCBD5E1)],
                    ),
                  ),
                  child: Center(
                    child: Text(
                      initials.isEmpty ? (isHome ? 'H' : 'A') : initials,
                      style: TextStyle(
                        color: primaryText,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              )
            : Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: isDark
                        ? const [Color(0xFF1E293B), Color(0xFF0F172A)]
                        : const [Color(0xFFE2E8F0), Color(0xFFCBD5E1)],
                  ),
                ),
                child: Center(
                  child: Text(
                    initials.isEmpty ? (isHome ? 'H' : 'A') : initials,
                    style: TextStyle(
                      color: primaryText,
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
      ),
      const SizedBox(height: 8),
      SizedBox(
        width: 105,
        child: Text(
          displayName,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontWeight: FontWeight.w800, 
            fontSize: 13,
            height: 1.15
          ),
        ),
      ),
      if (scoreText != null) ...[
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF1E293B) : const Color(0xFFE2E8F0),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: _screenBorder(context).withAlpha(100)),
          ),
          child: Text(
            scoreText,
            style: TextStyle(
              color: primaryText,
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ],
    ],
  );
}

class _MatchHeader extends StatelessWidget {
  const _MatchHeader({
    required this.prediction,
    required this.homeScore,
    required this.awayScore,
    required this.confidenceLabel,
    this.isPopularOverride,
  });

  final PredictionRecord prediction;
  final String? homeScore;
  final String? awayScore;
  final String confidenceLabel;
  final bool? isPopularOverride;

  @override
  Widget build(BuildContext context) {
    final isPopular = isPopularOverride ?? _isPopularPrediction(prediction);
    final isDark = _isDarkContext(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (isPopular) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFFF6D00).withAlpha(28),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFFF6D00).withAlpha(80)),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.whatshot, size: 14, color: Color(0xFFFF6D00)),
                    SizedBox(width: 4),
                    Text(
                      'POPULAR MATCH',
                      style: TextStyle(
                        color: Color(0xFFFF6D00),
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ),
              _StatusChip(label: confidenceLabel),
            ],
          ),
          const SizedBox(height: 12),
        ],
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: _teamBadge(
                context: context,
                logoUrl: prediction.homeTeamLogoUrl,
                teamName: prediction.homeTeamName,
                isHome: true,
                scoreText: homeScore,
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: isDark
                        ? const [Color(0xFF1E293B), Color(0xFF0F172A)]
                        : const [Color(0xFFE2E8F0), Color(0xFFCBD5E1)],
                    radius: 0.95,
                  ),
                  border: Border.all(
                    color: isDark
                        ? const Color(0xFF334155)
                        : const Color(0xFF94A3B8),
                    width: 1,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: isPopular
                          ? const Color(0xFFFF6D00).withAlpha(35)
                          : const Color(0xFF00D4AA).withAlpha(25),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Center(
                  child: Text(
                    'VS',
                    style: TextStyle(
                      color: isDark ? const Color(0xFFF1F5F9) : const Color(0xFF0F172A),
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.8,
                      shadows: [
                        Shadow(
                          color: isPopular
                              ? const Color(0xFFFF6D00).withAlpha(40)
                              : const Color(0xFF00D4AA).withAlpha(40),
                          blurRadius: 6,
                          offset: const Offset(0, 1),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: _teamBadge(
                context: context,
                logoUrl: prediction.awayTeamLogoUrl,
                teamName: prediction.awayTeamName,
                isHome: false,
                scoreText: awayScore,
              ),
            ),
          ],
        ),
        if (!isPopular) ...[
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: _StatusChip(label: confidenceLabel),
          ),
        ],
      ],
    );
  }
}

class _PickCard extends StatelessWidget {
  const _PickCard({super.key, required this.data});

  final _PickCardData data;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context, elevated: true);
    final border = _screenBorder(context);
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: surface,
        border: Border.all(color: border),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 4,
                color: data.accent,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (data.verdictLabel != null) ...[
                            _TinyVerdictChip(
                              label: data.verdictLabel!,
                              color: data.verdictColor!,
                            ),
                            const SizedBox(width: 8),
                          ],
                          Expanded(
                            child: Text(
                              data.label.toUpperCase(),
                              style: TextStyle(
                                color: _secondaryText(context),
                                fontSize: 11,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.8,
                              ),
                            ),
                          ),
                          if (data.confidence != null) ...[
                            const SizedBox(width: 8),
                            _ConfidencePill(value: data.confidence!),
                          ],
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _finalSelection(data),
                        style: TextStyle(
                          color: _primaryText(context),
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      if (data.reason != null && data.reason!.trim().isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          data.reason!,
                          style: TextStyle(
                            color: _secondaryText(context),
                            fontSize: 13,
                            height: 1.4,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LockedPickGate extends StatelessWidget {
  const _LockedPickGate({
    super.key,
    required this.isUnlocking,
    required this.onUnlockPressed,
  });

  final bool isUnlocking;
  final VoidCallback onUnlockPressed;

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    final cardBg = isDark
        ? const [Color(0xFF131E31), Color(0xFF0F1626)]
        : const [Color(0xFFEBEFF5), Color(0xFFDFE6EE)];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: LinearGradient(
          colors: cardBg,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: border, width: 1.2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF00D4AA).withAlpha(15),
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFF00D4AA).withAlpha(35), width: 1.5),
            ),
            child: const Icon(
              Icons.lock_person,
              color: Color(0xFF00D4AA),
              size: 28,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'PREDICTION LOCKED',
            style: TextStyle(
              color: primaryText,
              fontSize: 14,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Unlock this primary pick by watching a quick sponsor video.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: secondaryText,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isUnlocking ? null : onUnlockPressed,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF00D4AA),
                foregroundColor: const Color(0xFF0A0F1E),
                elevation: 4,
                shadowColor: const Color(0xFF00D4AA).withAlpha(60),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: isUnlocking
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          Color(0xFF0A0F1E),
                        ),
                      ),
                    )
                  : const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.play_circle_fill, size: 18, color: Color(0xFF0A0F1D)),
                        SizedBox(width: 8),
                        Text(
                          'Watch Ad to Unlock',
                          style: TextStyle(fontWeight: FontWeight.w900, fontSize: 13),
                        ),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TinyVerdictChip extends StatelessWidget {
  const _TinyVerdictChip({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withAlpha(28),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(80)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

String _finalSelection(_PickCardData data) {
  return data.selection ?? data.market ?? 'Selection';
}

String? _teamScoreLabel(String? currentGoals, String? fulltimeGoals) {
  final finalGoals = fulltimeGoals ?? currentGoals;
  if (finalGoals == null || finalGoals.trim().isEmpty) {
    return null;
  }
  return finalGoals.trim();
}

enum _PickVerdict { pending, correct, wrong }


_PickVerdict _pickVerdict(PredictionRecord prediction) {
  final outcome = prediction.matchOutcome?.trim().toLowerCase();
  if (outcome == 'void') {
    return _PickVerdict.correct;
  }

  final isFinished = _isFinishedPrediction(prediction, DateTime.now().toLocal());
  if (outcome == null || outcome.isEmpty) {
    return isFinished ? _PickVerdict.correct : _PickVerdict.pending;
  }

  final selection = _normalizeSelection(prediction);
  if (selection.isEmpty) {
    return _PickVerdict.pending;
  }

  final homeTeam = _normalizeText(prediction.homeTeamName ?? '');
  final awayTeam = _normalizeText(prediction.awayTeamName ?? '');
  final homeGoals = _goalCount(
    prediction.fulltimeHomeGoals ?? prediction.currentHomeGoals,
  );
  final awayGoals = _goalCount(
    prediction.fulltimeAwayGoals ?? prediction.currentAwayGoals,
  );

  if (selection.contains('btts')) {
    if (homeGoals == null || awayGoals == null) {
      return _PickVerdict.pending;
    }
    final yesPicked = selection.contains('yes');
    final actualYes = homeGoals > 0 && awayGoals > 0;
    return yesPicked == actualYes ? _PickVerdict.correct : _PickVerdict.wrong;
  }

  final overUnder = _parseOverUnderSelection(selection);
  if (overUnder != null) {
    if (homeGoals == null || awayGoals == null) {
      return _PickVerdict.pending;
    }
    final totalGoals = homeGoals + awayGoals;
    final actualCorrect = overUnder.isOver
        ? totalGoals > overUnder.line
        : totalGoals < overUnder.line;
    return actualCorrect ? _PickVerdict.correct : _PickVerdict.wrong;
  }

  if (selection.contains('home') ||
      selection.contains('1') ||
      selection.contains(homeTeam)) {
    return outcome == 'home' ? _PickVerdict.correct : _PickVerdict.wrong;
  }

  if (selection.contains('away') ||
      selection.contains('2') ||
      selection.contains(awayTeam)) {
    return outcome == 'away' ? _PickVerdict.correct : _PickVerdict.wrong;
  }

  if (selection.contains('draw') || selection == 'x') {
    return outcome == 'draw' ? _PickVerdict.correct : _PickVerdict.wrong;
  }

  if (prediction.predictedWinner != null) {
    final predictedWinner = _normalizeText(prediction.predictedWinner!);
    if (predictedWinner.isNotEmpty) {
      if (predictedWinner.contains(homeTeam)) {
        return outcome == 'home' ? _PickVerdict.correct : _PickVerdict.wrong;
      }
      if (predictedWinner.contains(awayTeam)) {
        return outcome == 'away' ? _PickVerdict.correct : _PickVerdict.wrong;
      }
      if (predictedWinner.contains('draw')) {
        return outcome == 'draw' ? _PickVerdict.correct : _PickVerdict.wrong;
      }
    }
  }

  return _PickVerdict.pending;
}

String _normalizeSelection(PredictionRecord prediction) {
  final selection = prediction.primaryPick?.selection?.trim() ?? '';
  if (selection.isNotEmpty) {
    return _normalizeText(selection);
  }

  final market = prediction.primaryPick?.market?.trim() ?? '';
  return _normalizeText(market);
}

String _normalizeText(String value) {
  return value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9.]+'), ' ').trim();
}

double? _goalCount(String? value) {
  if (value == null || value.trim().isEmpty) {
    return null;
  }
  return double.tryParse(value.trim());
}

_OverUnderSelection? _parseOverUnderSelection(String selection) {
  final match = RegExp(r'(over|under)\s*(\d+(?:\.\d+)?)').firstMatch(selection);
  if (match == null) {
    return null;
  }

  final line = double.tryParse(match.group(2) ?? '');
  if (line == null) {
    return null;
  }

  return _OverUnderSelection(isOver: match.group(1) == 'over', line: line);
}

class _OverUnderSelection {
  const _OverUnderSelection({required this.isOver, required this.line});

  final bool isOver;
  final double line;
}

class _ConfidencePill extends StatelessWidget {
  const _ConfidencePill({required this.value});

  final double value;

  @override
  Widget build(BuildContext context) {
    final accentText = _accentText(context);
    final percent = (value * 100).clamp(0, 100).round();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF00D4AA).withAlpha(31),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$percent%',
        style: TextStyle(
          color: accentText,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final surface = _isDarkContext(context)
        ? const Color(0xFF1E3147)
        : const Color(0xFFE6EEF7);
    final labelColor = _isDarkContext(context)
        ? const Color(0xFFB8D5FF)
        : const Color(0xFF4D647A);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          color: labelColor,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label, this.iconColor});

  final IconData icon;
  final String label;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);
    final effectiveIconColor = iconColor ?? _accentText(context);
    final surface = effectiveIconColor.withValues(alpha: isDark ? 0.12 : 0.08);
    final border = effectiveIconColor.withValues(alpha: isDark ? 0.25 : 0.15);
    final primaryText = _primaryText(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: effectiveIconColor),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: primaryText,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final accentText = _accentText(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: border),
      ),
      child: Column(
        children: [
          Icon(icon, size: 42, color: accentText),
          const SizedBox(height: 14),
          Text(
            title,
            style: TextStyle(
              color: primaryText,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: TextStyle(
              color: secondaryText.withAlpha(184),
              fontSize: 13,
              height: 1.4,
            ),
            textAlign: TextAlign.center,
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 16),
            FilledButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}

class _PickCardData {
  const _PickCardData({
    required this.label,
    required this.market,
    required this.selection,
    required this.confidence,
    required this.reason,
    required this.accent,
    required this.verdictLabel,
    required this.verdictColor,
  });

  final String label;
  final String? market;
  final String? selection;
  final double? confidence;
  final String? reason;
  final Color accent;
  final String? verdictLabel;
  final Color? verdictColor;

  bool get hasContent =>
      market != null ||
      selection != null ||
      confidence != null ||
      reason != null;

  factory _PickCardData.fromPick(
    String label,
    PredictionPick? pick,
    Color accent,
    PredictionRecord prediction,
  ) {
    final verdict = _pickVerdict(prediction);
    final verdictLabel = switch (verdict) {
      _PickVerdict.correct => 'Correct',
      _PickVerdict.wrong => 'Wrong',
      _PickVerdict.pending => null,
    };
    final verdictColor = switch (verdict) {
      _PickVerdict.correct => const Color(0xFF00D4AA),
      _PickVerdict.wrong => const Color(0xFFFF6B6B),
      _PickVerdict.pending => null,
    };

    return _PickCardData(
      label: label,
      market: pick?.market,
      selection: pick?.selection,
      confidence: pick?.confidence,
      reason: pick?.reason,
      accent: accent,
      verdictLabel: verdictLabel,
      verdictColor: verdictColor,
    );
  }
}

String _formatDate(DateTime? value) {
  final local = _localDateTime(value);
  if (local == null) {
    return 'unknown time';
  }
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${local.year}-$month-$day $hour:$minute';
}

String _formatDateTime(DateTime? value) {
  final local = _localDateTime(value);
  if (local == null) {
    return 'unknown time';
  }
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${local.year}-$month-$day $hour:$minute';
}

String _formatTimeOnly(DateTime? value) {
  final local = _localDateTime(value);
  if (local == null) {
    return 'unknown time';
  }

  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

String _matchStatusLabel(PredictionRecord prediction) {
  final statusShort = prediction.matchStatusShort?.toUpperCase();
  final statusLong = prediction.matchStatusLong?.trim();
  final now = DateTime.now().toLocal();

  if (_isFinishedPrediction(prediction, now)) {
    return 'Finished';
  }

  if (_isLivePrediction(prediction)) {
    return 'Live';
  }

  if (_isComingPrediction(prediction, now)) {
    return 'Coming';
  }

  if (statusLong != null && statusLong.isNotEmpty) {
    return statusLong;
  }

  return statusShort ?? 'Coming';
}

String _confidenceBadgeLabel(PredictionRecord prediction) {
  final confidence = prediction.confidence;
  if (confidence != null) {
    return confidence >= 0.85 ? 'high' : 'medium';
  }

  final rawLabel = prediction.confidenceLabel?.trim().toLowerCase() ?? '';
  if (rawLabel == 'high') {
    return 'high';
  }

  return 'medium';
}

double _predictionConfidenceValue(PredictionRecord prediction) {
  return prediction.confidence ?? prediction.primaryPick?.confidence ?? 0.0;
}

double _predictionConfidencePercentExact(PredictionRecord prediction) {
  return _predictionConfidenceValue(prediction) * 100.0;
}

int _predictionConfidencePercent(PredictionRecord prediction) {
  return (_predictionConfidenceValue(prediction) * 100).round();
}

bool _predictionMatchesPlan(
  PredictionRecord prediction,
  SubscriptionPlanId plan,
) {
  final confidence = _predictionConfidencePercent(prediction);
  final confidenceExact = _predictionConfidencePercentExact(prediction);
  return switch (plan) {
    SubscriptionPlanId.weeklyAdFree => true,
    SubscriptionPlanId.basic => confidence == 85,
    SubscriptionPlanId.standard => confidence >= 85 && confidence <= 87,
    SubscriptionPlanId.premium => confidenceExact >= 88.0 && confidenceExact <= 99.99,
  };
}

bool _isPopularPrediction(PredictionRecord prediction) {
  if (_predictionConfidencePercent(prediction) >= 85) return false;
  final home = prediction.homeTeamName?.toLowerCase() ?? '';
  final away = prediction.awayTeamName?.toLowerCase() ?? '';
  const popularClubs = [
    'madrid', 'barcelona', 'bayern', 'united', 'city', 'arsenal', 'liverpool',
    'chelsea', 'psg', 'juventus', 'milan', 'inter', 'dortmund', 'tottenham',
    'atletico', 'napoli', 'porto', 'benfica', 'ajax'
  ];
  return popularClubs.any((club) => home.contains(club) || away.contains(club));
}

String _planConfidenceLabel(SubscriptionPlanId plan) {
  return switch (plan) {
    SubscriptionPlanId.weeklyAdFree => 'Ad free for 7 days',
    SubscriptionPlanId.basic => '85%',
    SubscriptionPlanId.standard => '85% - 87%',
    SubscriptionPlanId.premium => '88% - 99.99%',
  };
}

Color _planAccentColor(SubscriptionPlanId plan) {
  return switch (plan) {
    SubscriptionPlanId.weeklyAdFree => const Color(0xFF00D4AA),
    SubscriptionPlanId.basic => const Color(0xFF4A8DFF),
    SubscriptionPlanId.standard => const Color(0xFF28C58F),
    SubscriptionPlanId.premium => const Color(0xFFF4C15D),
  };
}

List<Color> _planGradientColors(
  SubscriptionPlanId plan,
  BuildContext context,
) {
  final isDark = _isDarkContext(context);
  return switch (plan) {
    SubscriptionPlanId.weeklyAdFree => isDark
        ? const [Color(0xFF063B36), Color(0xFF0E2238), Color(0xFF123652)]
        : const [Color(0xFFDDFBF4), Color(0xFFCDEAFF), Color(0xFFF7FFFB)],
    SubscriptionPlanId.basic => isDark
        ? const [Color(0xFF0E2B63), Color(0xFF123A88), Color(0xFF2A5AE8)]
        : const [Color(0xFFE4EEFF), Color(0xFFD6E7FF), Color(0xFFF5FAFF)],
    SubscriptionPlanId.standard => isDark
        ? const [Color(0xFF0E3F35), Color(0xFF134F45), Color(0xFF1B705D)]
        : const [Color(0xFFE3FFF7), Color(0xFFD8F8EE), Color(0xFFF5FFFC)],
    SubscriptionPlanId.premium => isDark
        ? const [Color(0xFF4A3109), Color(0xFF754C10), Color(0xFFAD751E)]
        : const [Color(0xFFFFF4D8), Color(0xFFFFEBC0), Color(0xFFFFFAF0)],
  };
}

List<String> _planBenefitLines(SubscriptionPlanId plan) {
  return switch (plan) {
    SubscriptionPlanId.weeklyAdFree => const [
      '7 days without ads',
      'Cleaner match browsing',
      'Perfect short-term upgrade',
    ],
    SubscriptionPlanId.basic => const [
      'Budget-friendly access',
      'Stay close to the feed',
      'Great starter tier',
    ],
    SubscriptionPlanId.standard => const [
      'Balanced access level',
      'More prediction depth',
      'Built for regular users',
    ],
    SubscriptionPlanId.premium => const [
      'Top-tier access focus',
      'Best for heavy usage',
      'Unlock the strongest tier',
    ],
  };
}

IconData _matchStatusIcon(PredictionRecord prediction) {
  final label = _matchStatusLabel(prediction).toLowerCase();
  if (label.contains('live') || label.contains('going')) {
    return Icons.play_circle;
  }
  return Icons.schedule;
}

class _HeaderInfoCarousel extends StatefulWidget {
  const _HeaderInfoCarousel({
    required this.predictions,
    required this.onOpenPremium,
    required this.onOpenPopularMatches,
  });

  final List<PredictionRecord> predictions;
  final VoidCallback onOpenPremium;
  final VoidCallback onOpenPopularMatches;

  @override
  State<_HeaderInfoCarousel> createState() => _HeaderInfoCarouselState();
}

class _HeaderInfoCarouselState extends State<_HeaderInfoCarousel> {
  late final PageController _controller;
  int _currentPage = 0;
  Timer? _autoPlayTimer;
  late final Future<Map<String, dynamic>> _todayStatsFuture;

  @override
  void initState() {
    super.initState();
    _controller = PageController();
    _todayStatsFuture = PredictionRepository().getTodayStats();
    _autoPlayTimer = Timer.periodic(const Duration(seconds: 6), (timer) {
      if (!mounted) return;
      final nextPage = (_currentPage + 1) % 3;
      _controller.animateToPage(
        nextPage,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _autoPlayTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Widget _buildSubscriptionSlide(BuildContext context, bool isDark) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final border = isDark ? const Color(0xFF6B4E1A) : const Color(0xFFFCDCA2);
    final gradientColors = isDark
        ? [const Color(0xFF3B2A0F), const Color(0xFF0A0F1E)]
        : [const Color(0xFFFFF7E6), Colors.white];

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border.withAlpha(120), width: 1.2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onOpenPremium,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFB300).withAlpha(20),
                    shape: BoxShape.circle,
                    border: Border.all(color: const Color(0xFFFFB300).withAlpha(40)),
                  ),
                  child: const Icon(Icons.workspace_premium, color: Color(0xFFFFB300), size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        "Unlock Premium Plans",
                        style: TextStyle(
                          color: primaryText,
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        "Ad-Free • Exclusive Predictions • Early Access",
                        style: TextStyle(
                          color: secondaryText,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: widget.onOpenPremium,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFFFFB300),
                    foregroundColor: const Color(0xFF0A0F1E),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text(
                    "Subscribe",
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w900),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = _isDarkContext(context);

    return Column(
      children: [
        SizedBox(
          height: 122,
          child: PageView(
            controller: _controller,
            onPageChanged: (page) {
              setState(() {
                _currentPage = page;
              });
            },
            children: [
              FutureBuilder<Map<String, dynamic>>(
                future: _todayStatsFuture,
                builder: (context, snapshot) {
                  final stats = snapshot.data;
                  final totalCorrect = stats?['totalCorrect'] ?? 0;
                  final totalChecked = stats?['totalChecked'] ?? 0;
                  final accuracy = stats?['accuracy'] ?? 86;

                  return _buildCarouselCard(
                    context,
                    gradientColors: isDark
                        ? [const Color(0xFF0F1E36), const Color(0xFF0A0F1E)]
                        : [const Color(0xFFE6F4F1), Colors.white],
                    border: isDark ? const Color(0xFF233554) : const Color(0xFFBFE3DC),
                    icon: Icons.analytics,
                    iconColor: const Color(0xFF00D4AA),
                    title: "Today's Dynamic Stats",
                    body: snapshot.connectionState == ConnectionState.waiting
                        ? "Calculating today's statistics..."
                        : "Win Rate: $accuracy% Accuracy today.\nMatches solved: $totalCorrect won out of $totalChecked completed matches today.",
                    onTap: null,
                  );
                },
              ),
              _buildSubscriptionSlide(context, isDark),
              _buildCarouselCard(
                context,
                gradientColors: isDark
                    ? [const Color(0xFF361810), const Color(0xFF0A0F1E)]
                    : [const Color(0xFFFFEBE5), Colors.white],
                border: isDark ? const Color(0xFF662F20) : const Color(0xFFFFC4B3),
                icon: Icons.whatshot,
                iconColor: const Color(0xFFFF5252),
                title: "Popular Matches Feed",
                body: "Chelsea, Arsenal, Barca & Real Madrid. Tap to view today's hottest fixtures.",
                onTap: widget.onOpenPopularMatches,
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(3, (index) {
            final active = index == _currentPage;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              margin: const EdgeInsets.symmetric(horizontal: 4),
              width: active ? 16 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: active
                    ? const Color(0xFF00D4AA)
                    : _screenBorder(context).withAlpha(150),
                borderRadius: BorderRadius.circular(3),
                boxShadow: active
                    ? [
                        BoxShadow(
                          color: const Color(0xFF00D4AA).withValues(alpha: 0.6),
                          blurRadius: 6,
                          spreadRadius: 1.5,
                        ),
                      ]
                    : null,
              ),
            );
          }),
        ),
      ],
    );
  }

  Widget _buildCarouselCard(
    BuildContext context, {
    required List<Color> gradientColors,
    required Color border,
    required IconData icon,
    required Color iconColor,
    required String title,
    required String body,
    required VoidCallback? onTap,
  }) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: border.withAlpha(120), width: 1.2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: iconColor.withAlpha(20),
                    shape: BoxShape.circle,
                    border: Border.all(color: iconColor.withAlpha(40)),
                  ),
                  child: Icon(icon, color: iconColor, size: 24),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: _primaryText(context),
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        body,
                        style: TextStyle(
                          color: _secondaryText(context),
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          height: 1.35,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                if (onTap != null) ...[
                  const SizedBox(width: 8),
                  Icon(
                    Icons.chevron_right,
                    color: _secondaryText(context).withAlpha(150),
                    size: 20,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class PopularMatchesPage extends StatefulWidget {
  const PopularMatchesPage({
    super.key,
    required this.predictions,
    required this.adFree,
    required this.isAdmin,
  });

  final List<PredictionRecord> predictions;
  final bool adFree;
  final bool isAdmin;

  @override
  State<PopularMatchesPage> createState() => _PopularMatchesPageState();
}

class _PopularMatchesPageState extends State<PopularMatchesPage> {
  final Set<String> _unlockedPickKeys = <String>{};
  String? _unlockingPickKey;

  bool _isPickUnlocked(PredictionRecord prediction) {
    if (widget.adFree) return true;
    final unlockKey = _predictionUnlockKey(prediction);
    if (_unlockedPickKeys.contains(unlockKey)) return true;
    // Check subscription plan access
    final activePlan = GooglePlayBillingService.instance.activePlan;
    if (activePlan != null && _predictionMatchesPlan(prediction, activePlan)) {
      return true;
    }
    return false;
  }

  Future<void> _unlockPick(PredictionRecord prediction) async {
    if (widget.adFree) return;
    final unlockKey = _predictionUnlockKey(prediction);
    if (unlockKey.isEmpty || _unlockedPickKeys.contains(unlockKey)) return;
    if (_unlockingPickKey == unlockKey) return;

    setState(() {
      _unlockingPickKey = unlockKey;
    });

    try {
      final didUnlock = await AdGateService.instance.showRewardedAd();
      if (!mounted) return;
      if (didUnlock) {
        setState(() {
          _unlockedPickKeys.add(unlockKey);
        });
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Ad not ready yet. Please try again.')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _unlockingPickKey = null;
        });
      }
    }
  }

  Future<void> _openComments(PredictionRecord prediction) {
    return showPredictionCommentsSheet(context, prediction);
  }

  @override
  Widget build(BuildContext context) {
    final popularList = widget.predictions.where(_isPopularPrediction).toList();
    final isDark = _isDarkContext(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Popular Matches'),
        backgroundColor: isDark ? const Color(0xFF0A0F1E) : const Color(0xFFF5F7FB),
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: _screenGradient(context),
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: popularList.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: _EmptyState(
                      icon: Icons.sports_soccer,
                      title: 'No popular matches',
                      message: 'There are no active matches flagged as popular right now.',
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                  itemCount: popularList.length,
                  itemBuilder: (context, index) {
                    final prediction = popularList[index];
                    final unlockKey = _predictionUnlockKey(prediction);
                    final isLocked = !_isPickUnlocked(prediction);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: PredictionGroupCard(
                        prediction: prediction,
                        isLocked: isLocked,
                        isUnlocking: _unlockingPickKey == unlockKey,
                        onUnlockPressed: () => _unlockPick(prediction),
                        isSelected: false,
                        canSelect: false,
                        onSelectionPressed: () {},
                        onOpenComments: () => _openComments(prediction),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

class _PulsingIcon extends StatefulWidget {
  const _PulsingIcon({required this.icon, required this.isActive});

  final IconData icon;
  final bool isActive;

  @override
  State<_PulsingIcon> createState() => _PulsingIconState();
}

class _PulsingIconState extends State<_PulsingIcon> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _glowAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 1.12).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    _glowAnimation = Tween<double>(begin: 3.0, end: 11.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    if (widget.isActive) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void didUpdateWidget(covariant _PulsingIcon oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isActive != oldWidget.isActive) {
      if (widget.isActive) {
        _controller.repeat(reverse: true);
      } else {
        _controller.stop();
        _controller.value = 0.0;
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isActive) {
      return Icon(widget.icon);
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return ScaleTransition(
          scale: _scaleAnimation,
          child: Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF00D4AA).withValues(alpha: 0.35),
                  blurRadius: _glowAnimation.value,
                  spreadRadius: _glowAnimation.value * 0.15,
                ),
              ],
            ),
            child: Icon(
              widget.icon,
              color: const Color(0xFF00D4AA),
            ),
          ),
        );
      },
    );
  }
}
