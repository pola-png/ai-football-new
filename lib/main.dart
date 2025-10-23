import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter/gestures.dart';
import 'package:in_app_purchase/in_app_purchase.dart';


import 'package:intl/intl.dart';

import 'package:flutter/services.dart';


import 'dart:async';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'dart:ui';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';


void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Start app immediately
  runApp(const AgeVerificationWrapper());
  
  // Initialize services in background
  _initializeServices();
}

void _initializeServices() async {
  try {
    MobileAds.instance.initialize();
    RewardedAdManager.loadAd();
    
    await Supabase.initialize(
      url: 'https://wlrukpxzyqrjepovabei.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndscnVrcHh6eXFyamVwb3ZhYmVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwNzM0MjgsImV4cCI6MjA3NDY0OTQyOH0.nuwcFPs2sXDCpjuIetFO1l__ZVdMD5PuJfm81s_JSCw',
    );
    
    NotificationService.initialize();
  } catch (e) {
    // Silently fail initialization
  }
}

class AgeVerificationWrapper extends StatefulWidget {
  const AgeVerificationWrapper({super.key});

  @override
  State<AgeVerificationWrapper> createState() => _AgeVerificationWrapperState();
}

class _AgeVerificationWrapperState extends State<AgeVerificationWrapper> {
  bool _ageVerified = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _checkAgeVerification();
  }

  Future<void> _checkAgeVerification() async {
    final prefs = await SharedPreferences.getInstance();
    final verified = prefs.getBool('age_verified') ?? false;
    setState(() {
      _ageVerified = verified;
      _loading = false;
    });
  }

  Future<void> _confirmAge() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('age_verified', true);
    setState(() {
      _ageVerified = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const MaterialApp(
        home: Scaffold(
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    if (!_ageVerified) {
      return MaterialApp(
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.verified_user, size: 80, color: Colors.blue),
                  const SizedBox(height: 24),
                  const Text(
                    'Age Verification Required',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'This app contains sports betting predictions.\n\nBy continuing, you confirm that you are 18 years or older and agree to our Terms of Service.',
                    style: TextStyle(fontSize: 16),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  ElevatedButton(
                    onPressed: _confirmAge,
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(double.infinity, 50),
                    ),
                    child: const Text('I am 18 or older'),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: () => SystemNavigator.pop(),
                    child: const Text('Exit App'),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return const AuthWrapper();
  }
}

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: Supabase.instance.client.auth.onAuthStateChange.map((data) => data.session?.user),
      builder: (context, snapshot) {
        return Provider<User?>.value(
          value: snapshot.data,
          child: const MyApp(),
        );
      },
    );
  }
}

class UserProfile {
  final String username;
  final bool isAdmin;
  final int vipTier;

  UserProfile({this.username = 'Guest', this.isAdmin = false, this.vipTier = 0});
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final supabaseUser = Provider.of<User?>(context);

    return StreamProvider<UserProfile?>.value(
      value: supabaseUser != null
          ? Supabase.instance.client.from('profiles').stream(primaryKey: ['id']).eq('id', supabaseUser.id).map((maps) {
              if (maps.isEmpty) {
                return UserProfile();
              }
              final data = maps.first;
              final username = data['username'] ?? 'User';
              final isAdmin = data['role'] == 'admin';
              final vipTier = data['vip_tier'] ?? 0;
              return UserProfile(
                username: username,
                isAdmin: isAdmin,
                vipTier: vipTier,
              );
            })
          : Stream.value(null),
      initialData: null,
      child: MaterialApp(
          title: 'Football Prediction App',
          debugShowCheckedModeBanner: false,
          theme: ThemeData.dark().copyWith(
            primaryColor: const Color(0xFF0A192F),
            scaffoldBackgroundColor: const Color(0xFF0A192F),
            cardColor: const Color(0xFF172A46),
            colorScheme: const ColorScheme.dark(
              primary: Color(0xFF64FFDA),
              secondary: Color(0xFF64FFDA),
              surface: Color(0xFF172A46),
              onPrimary: Colors.black,
              onSecondary: Colors.black,
              onSurface: Color(0xFFCCD6F6),
              error: Colors.redAccent,
            ),
          ),
          home: const MainScreen(),
        ),
    );
  }
}

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _isLogin = true; // To toggle between login and signup
  bool agreed = false;
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool loading = false;
  String? error;

  Future<void> _submitAuthForm() async {
    setState(() { loading = true; error = null; });
    try {
      if (_isLogin) {
        await Supabase.instance.client.auth.signInWithPassword(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
        );
      } else {
        if (!agreed) {
          throw Exception("You must agree to the terms to sign up.");
        }
        await Supabase.instance.client.auth.signUp(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
          data: {
            'username': _usernameController.text.trim(),
          },
        );
      }
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const MainScreen()),
        );
      }
    } on AuthException catch (e) {
      if (mounted) {
        setState(() { error = e.message; });
      }
    } finally {
      if (mounted) {
        setState(() { loading = false; });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center, 
            children: [
              const Icon(Icons.sports_soccer, size: 80, color: Color(0xFF64FFDA)),
              const SizedBox(height: 16),
              Text(_isLogin ? 'Welcome Back' : 'Create Account', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Color(0xFFCCD6F6))),
              const SizedBox(height: 24),
              if (!_isLogin)
                TextField(
                  controller: _usernameController,
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    border: OutlineInputBorder(),
                  ),
                ),
              if (!_isLogin) const SizedBox(height: 16),
              TextField(
                controller: _emailController,
                decoration: const InputDecoration(
                  labelText: 'Email',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _passwordController,
                decoration: const InputDecoration(
                  labelText: 'Password',
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
              const SizedBox(height: 24),
              if (!_isLogin)
                Column(
                  children: [
                    CheckboxListTile(
                      value: agreed,
                      controlAffinity: ListTileControlAffinity.leading,
                      onChanged: (v) => setState(() { agreed = v ?? false; }),
                      title: RichText(
                        text: TextSpan(
                          text: 'I am 18+ and agree to the ',
                          style: DefaultTextStyle.of(context).style.copyWith(fontSize: 14),
                          children: <TextSpan>[
                            TextSpan(
                              text: 'Terms of Use',
                              style: const TextStyle(color: Colors.blue, decoration: TextDecoration.underline),
                              recognizer: TapGestureRecognizer()
                                ..onTap = () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyPolicyScreen())),
                            ),
                          ],
                        ),
                      ),
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.policy, size: 18),
                      label: const Text('Read Privacy Policy'),
                      onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyPolicyScreen())),
                    ),
                  ],
                ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: loading ? null : _submitAuthForm,
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size(double.infinity, 50),
                ),
                child: loading ? const CircularProgressIndicator(color: Colors.white) : Text(_isLogin ? 'Sign In' : 'Sign Up'),
              ),
              if (error != null) ...[
                const SizedBox(height: 12),
                Text(error!, style: const TextStyle(color: Colors.red)),
              ],
              TextButton(
                onPressed: () {
                  setState(() {
                    _isLogin = !_isLogin;
                    error = null;
                  });
                },
                child: Text(_isLogin ? 'Don\'t have an account? Sign Up' : 'Already have an account? Sign In'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Privacy & Content Policy'),
      ),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Football Prediction App\n\nPRIVACY POLICY & TERMS OF SERVICE',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 16),
            Text(
              'INFORMATION WE COLLECT\n\n'
              '• Account Information: Username and email address for authentication\n'
              '• Usage Data: App interactions, prediction views, and feature usage for analytics\n'
              '• Device Information: Device type, operating system, and advertising ID for ad personalization\n\n'
              'HOW WE USE YOUR INFORMATION\n\n'
              '• Provide football prediction services and VIP tier access\n'
              '• Enable community chat features between users\n'
              '• Process in-app purchases for VIP subscriptions\n'
              '• Display personalized advertisements through Google AdMob\n'
              '• Send notifications about new predictions and app updates\n\n'
              'COMMUNITY FEATURES\n\n'
              '• Users can participate in community chat and prediction discussions\n'
              '• Messages are stored on our servers and visible to other users\n'
              '• Users must be 18+ to use the app and agree to these terms\n'
              '• Prohibited content includes adult material, violence, harassment, or illegal activities\n\n'
              'IN-APP PURCHASES\n\n'
              '• VIP subscriptions provide access to premium predictions with higher accuracy\n'
              '• Purchases are processed through Google Play Store\n'
              '• VIP tiers: Basic (\$2.99), Standard (\$9.99), Premium (\$24.99), Ultra VIP (\$49.99)\n'
              '• No refunds for digital content once accessed\n'
              '• Subscriptions do not auto-renew and are one-time purchases\n\n'
              'ADVERTISING\n\n'
              '• We display ads through Google AdMob to support the free app\n'
              '• Ad partners may collect device information for personalized advertising\n'
              '• Users can watch rewarded ads to unlock free predictions\n\n'
              'DATA SECURITY\n\n'
              '• All data is encrypted and stored securely using Supabase infrastructure\n'
              '• We do not share personal information with third parties except ad networks\n'
              '• Users can delete their account and data through the profile settings\n\n'
              'DISCLAIMER\n\n'
              '• Predictions are for entertainment purposes only\n'
              '• We do not guarantee prediction accuracy or betting outcomes\n'
              '• Users are responsible for their own betting decisions\n'
              '• This app does not facilitate gambling or betting transactions\n\n'
              'CONTACT\n\n'
              'For questions about this policy or to delete your data, contact us through the app settings.',
            ),
          ],
        ),
      ),
    );
  }
}

class MainScreen extends StatefulWidget {
  final int initialTab;
  final String? vipTier;
  final String? vipTierName;
  const MainScreen({super.key, this.initialTab = 0, this.vipTier, this.vipTierName});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  late int _selectedIndex;

  @override
  void initState() {
    super.initState();
    _selectedIndex = widget.initialTab;
  }

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context);
    final isAdmin = userProfile?.isAdmin ?? false;

    // Swap Free and Community so Free is now first
    final List<Widget> screens = [
      const FreePredictionsWidget(),
      const CommunityScreen(),
      widget.vipTier != null ? VIPTierPredictionsList(tier: widget.vipTier!, tierName: widget.vipTierName!) : const VIPPredictionsWidget(),
      if (isAdmin) const AdminScreen(),
    ];

    final List<BottomNavigationBarItem> navItems = [
      const BottomNavigationBarItem(icon: Icon(Icons.article_outlined), activeIcon: Icon(Icons.article), label: 'Free'),
      const BottomNavigationBarItem(icon: Icon(Icons.chat_bubble_outline), activeIcon: Icon(Icons.chat_bubble), label: 'Community'),
      const BottomNavigationBarItem(icon: Icon(Icons.star_outline), activeIcon: Icon(Icons.star), label: 'VIP'),
      if (isAdmin) const BottomNavigationBarItem(icon: Icon(Icons.admin_panel_settings_outlined), activeIcon: Icon(Icons.admin_panel_settings), label: 'Admin'),
    ];

    return Scaffold(
      body: SafeArea(
        child: IndexedStack(
          index: _selectedIndex,
          children: screens,
        ),
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: _onItemTapped,
        items: navItems,
        type: BottomNavigationBarType.fixed,
      ),
    );
  }
}

class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});
  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  late final TextEditingController _msgController;
  late final ScrollController _scrollController;
  bool showEmojiPicker = false;
  final List<Map<String, dynamic>> _localMessages = [];

  @override
  void initState() {
    super.initState();
    _msgController = TextEditingController();
    _scrollController = ScrollController();
  }

  @override
  void dispose() {
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Track screen view
    AnalyticsService.logEvent('screen_view', parameters: {'screen': 'community_chat'});
    
    return Column(
      children: [
        AppBar(
          title: const Text('Community Chat'),
          actions: [
            IconButton(
              icon: const Icon(Icons.account_circle),
              onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
            ),
          ],
        ),
        Expanded(
          child: StreamBuilder<List<Map<String, dynamic>>>(
            stream: Supabase.instance.client
                .from('community_messages')
                .stream(primaryKey: ['id'])
                .order('created_at', ascending: true),
            builder: (context, snapshot) {

              final dbMessages = snapshot.data ?? [];
              final allMessages = [...dbMessages, ..._localMessages];
              
              if (allMessages.isEmpty) {
                return const Center(child: Text('No messages yet.'));
              }
              final messages = allMessages;

              
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (_scrollController.hasClients) {
                  Future.delayed(const Duration(milliseconds: 100), () {
                    if (_scrollController.hasClients) {
                      _scrollController.animateTo(
                        _scrollController.position.maxScrollExtent,
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeOut,
                      );
                    }
                  });
                }
              });

              return ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.only(bottom: 8, top: 8),
                itemCount: messages.length + (messages.length ~/ 2),
                reverse: false,
                itemBuilder: (context, index) {
                  if ((index + 1) % 3 == 0) {
                    return const AdBannerWidget();
                  }
                  final messageIndex = index - (index ~/ 3);
                  if (messageIndex >= messages.length) return const SizedBox.shrink();
                  final message = messages[messageIndex];
                  return ChatBubble(message: message, messageId: message['id'].toString());
                },
              );
            },
          ),
        ),
        Row(
          children: [
            IconButton(
              icon: const Icon(Icons.emoji_emotions),
              onPressed: () => setState(() => showEmojiPicker = !showEmojiPicker),
            ),
            Expanded(
              child: TextField(
                controller: _msgController,
                decoration: const InputDecoration(
                  hintText: 'Type a message...',
                  border: InputBorder.none,
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.send),
              onPressed: () {
                final text = _msgController.text.trim();
                final userProfile = Provider.of<UserProfile?>(context, listen: false);
                final user = Supabase.instance.client.auth.currentUser;
                if (text.isNotEmpty && user != null) {
                  _msgController.clear();
                  
                  // Add message instantly to local list
                  final newMessage = {
                    'id': DateTime.now().millisecondsSinceEpoch.toString(),
                    'user_id': user.id,
                    'username': userProfile?.username ?? 'Anonymous',
                    'content': text,
                    'created_at': DateTime.now().toIso8601String(),
                  };
                  
                  setState(() {
                    _localMessages.add(newMessage);
                  });
                  
                  // Save to database in background
                  Supabase.instance.client.from('community_messages').insert({
                    'user_id': user.id,
                    'username': userProfile?.username ?? 'Anonymous',
                    'content': text,
                  }).then((_) {
                    // Remove from local list once saved to DB
                    setState(() {
                      _localMessages.removeWhere((msg) => msg['id'] == newMessage['id']);
                    });
                  });
                  
                  Future.delayed(const Duration(milliseconds: 100), () {
                    if (_scrollController.hasClients) {
                      _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
                    }
                  });
                }
              },
            ),
          ],
        ),

      ],
    );
  }
}

class ChatBubble extends StatelessWidget {
  final Map<dynamic, dynamic> message;
  final String messageId;

  const ChatBubble({super.key, required this.message, required this.messageId});

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context, listen: false);
    final currentUser = Supabase.instance.client.auth.currentUser;
    final isMe = message['user_id'] == currentUser?.id;
    final isAdmin = userProfile?.isAdmin ?? false;
    final timestamp = DateTime.parse(message['created_at']);
    final timeStr = DateFormat('h:mm a').format(timestamp);
    final dateStr = DateFormat('MMM d').format(timestamp);

    return GestureDetector(
      onLongPress: () {
        if (isAdmin) {
          showDialog(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('Delete Message?'),
              content: const Text('This action cannot be undone.'),
              actions: [
                TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
                TextButton(
                  onPressed: () {
                    Supabase.instance.client.from('community_messages').delete().eq('id', messageId);
                    Navigator.of(ctx).pop();
                  },
                  child: const Text('Delete', style: TextStyle(color: Colors.red)),
                ),
              ],
            ),
          );
        }
      },
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
        alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
          decoration: BoxDecoration(
            color: isMe ? Theme.of(context).colorScheme.primary : Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!isMe) Text(message['username'] ?? 'User', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Theme.of(context).colorScheme.primary)),
              Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Flexible(child: Text(message['content'] ?? '', style: TextStyle(color: isMe ? Colors.black : Colors.white))),
                  const SizedBox(width: 8),
                  Text('$dateStr $timeStr', style: TextStyle(fontSize: 10, color: isMe ? Colors.black54 : Colors.white54)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AdBannerWidget extends StatefulWidget {
  const AdBannerWidget({super.key});
  @override
  State<AdBannerWidget> createState() => _AdBannerWidgetState();
}

class _AdBannerWidgetState extends State<AdBannerWidget> {
  BannerAd? _bannerAd;
  bool _isLoaded = false;
  bool _isDisposed = false;

  @override
  void initState() {
    super.initState();
    _loadAd();
  }

  void _loadAd() {
    if (_isDisposed) return;
    _bannerAd = BannerAd(
      adUnitId: 'ca-app-pub-3088816615654692/8974343280',
      size: AdSize.banner,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (_) {
          if (!_isDisposed && mounted) {
            setState(() => _isLoaded = true);
          }
        },
        onAdFailedToLoad: (ad, error) {
          ad.dispose();
          if (!_isDisposed && mounted) {
            setState(() => _isLoaded = false);
          }
        },
      ),
    )..load();
  }

  @override
  void dispose() {
    _isDisposed = true;
    _bannerAd?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_bannerAd != null && _isLoaded && !_isDisposed) {
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Theme.of(context).cardColor.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(8),
        ),
        width: _bannerAd!.size.width.toDouble(),
        height: _bannerAd!.size.height.toDouble(),
        child: AdWidget(ad: _bannerAd!),
      );
    }
    return const SizedBox(height: 60); // Placeholder height to prevent layout shifts
  }
}

class NativeAdWidget extends StatefulWidget {
  const NativeAdWidget({super.key});
  @override
  State<NativeAdWidget> createState() => _NativeAdWidgetState();
}

class _NativeAdWidgetState extends State<NativeAdWidget> {
  NativeAd? _nativeAd;
  bool _isLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadAd();
  }

  void _loadAd() {
    _nativeAd = NativeAd(
      adUnitId: 'ca-app-pub-3088816615654692/5052884920',
      request: const AdRequest(),
      listener: NativeAdListener(
        onAdLoaded: (_) => setState(() => _isLoaded = true),
        onAdFailedToLoad: (ad, error) => ad.dispose(),
      ),
      nativeTemplateStyle: NativeTemplateStyle(
        templateType: TemplateType.medium,
        mainBackgroundColor: const Color(0xFF172A46),
        cornerRadius: 10.0,
      ),
    )..load();
  }

  @override
  void dispose() {
    _nativeAd?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_nativeAd != null && _isLoaded) {
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
        height: 300,
        child: AdWidget(ad: _nativeAd!),
      );
    }
    return const SizedBox.shrink();
  }
}

class AnalyticsService {
  // Track events in Supabase
  static Future<void> logEvent(String eventName, {Map<String, Object>? parameters}) async {
    try {
      await Supabase.instance.client.from('analytics_events').insert({
        'event_name': eventName,
        'parameters': parameters,
        'user_id': Supabase.instance.client.auth.currentUser?.id,
        'created_at': DateTime.now().toIso8601String(),
      });
    } catch (e) {
      // Analytics error silently ignored
    }
  }
}

class NotificationService {
  static final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();
  static int _notificationId = 0;

  static Future<void> initialize() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);
    
    await _notifications.initialize(initSettings);
    
    // Listen for new predictions in real-time
    _listenForNewPredictions();
  }

  static void _listenForNewPredictions() {
    // Listen to predictions table for new entries
    Supabase.instance.client
        .from('predictions')
        .stream(primaryKey: ['id'])
        .listen((data) {
      if (data.isNotEmpty) {
        final latest = data.last;
        final createdAt = DateTime.parse(latest['created_at']);
        final now = DateTime.now();
        
        // Only notify if prediction was created in the last 10 seconds
        if (now.difference(createdAt).inSeconds < 10) {
          _showNotification(
            'New Prediction Available!',
            '${latest['home_team']} vs ${latest['away_team']} - ${latest['prediction_type']}',
          );
        }
      }
    });
  }

  static Future<void> _showNotification(String title, String body) async {
    const androidDetails = AndroidNotificationDetails(
      'predictions',
      'Prediction Notifications',
      channelDescription: 'Notifications for new football predictions',
      importance: Importance.high,
      priority: Priority.high,
    );
    
    const notificationDetails = NotificationDetails(android: androidDetails);
    
    await _notifications.show(
      _notificationId++,
      title,
      body,
      notificationDetails,
    );
  }

  static Future<void> sendNotificationToAll(String title, String body) async {
    // Show local notification immediately
    await _showNotification(title, body);
  }
}

class RewardedAdManager {
  static RewardedAd? _rewardedAd;
  static bool _isLoaded = false;

  static void loadAd() {
    RewardedAd.load(
      adUnitId: 'ca-app-pub-3088816615654692/7661261618',
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) {
          _rewardedAd = ad;
          _isLoaded = true;
        },
        onAdFailedToLoad: (error) {
          _isLoaded = false;
        },
      ),
    );
  }

  static void showAd(Function onRewarded) {
    if (_rewardedAd != null && _isLoaded) {
      _rewardedAd!.show(
        onUserEarnedReward: (ad, reward) {
          onRewarded();
        },
      );
      _rewardedAd!.fullScreenContentCallback = FullScreenContentCallback(
        onAdDismissedFullScreenContent: (ad) {
          ad.dispose();
          _isLoaded = false;
          loadAd();
        },
      );
    }
  }

  static bool get isLoaded => _isLoaded;
}

class FreePredictionsWidget extends StatefulWidget {
  const FreePredictionsWidget({super.key});
  @override
  State<FreePredictionsWidget> createState() => _FreePredictionsWidgetState();
}

class _FreePredictionsWidgetState extends State<FreePredictionsWidget> {
  final Set<String> _unlockedPredictions = {};
  late Stream<List<Map<String, dynamic>>> _predictionsStream;
  bool _isRefreshing = false;

  @override
  void initState() {
    super.initState();
    _initializeStream();
  }

  void _initializeStream() {
    _predictionsStream = Supabase.instance.client
        .from('predictions')
        .stream(primaryKey: ['id'])
        .eq('is_free', true)
        .order('created_at', ascending: false);
  }

  Future<void> _refreshData() async {
    setState(() { _isRefreshing = true; });
    try {
      _initializeStream();
      await Future.delayed(const Duration(milliseconds: 500));
    } finally {
      if (mounted) setState(() { _isRefreshing = false; });
    }
  }

  void _unlockPrediction(String predictionId) {
    setState(() {
      _unlockedPredictions.add(predictionId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context);
    final isAdmin = userProfile?.isAdmin ?? false;
    
    // Track screen view
    AnalyticsService.logEvent('screen_view', parameters: {'screen': 'free_predictions'});
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('Free Predictions'),
        actions: [
          if (isAdmin)
            IconButton(
              icon: const Icon(Icons.add_circle_outline),
              onPressed: () {
                HapticFeedback.lightImpact();
                showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => const FreePredictionAdminForm(),
                );
              },
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refreshData,
          ),
          IconButton(
            icon: const Icon(Icons.account_circle),
            onPressed: () {
              final user = Supabase.instance.client.auth.currentUser;
              if (user == null) {
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AuthScreen()));
              } else {
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen()));
              }
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshData,
        child: StreamBuilder<List<Map<String, dynamic>>>(
          stream: _predictionsStream,
          builder: (context, snapshot) {
            if (_isRefreshing) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('Error loading predictions'),
                    ElevatedButton(
                      onPressed: _refreshData,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              );
            }
            if (!snapshot.hasData || snapshot.data!.isEmpty) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('No predictions yet.'),
                    ElevatedButton(
                      onPressed: _refreshData,
                      child: const Text('Refresh'),
                    ),
                  ],
                ),
              );
            }
            final posts = snapshot.data!;
            return ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: posts.length + posts.length,
              itemBuilder: (context, index) {
                if (index.isOdd) {
                  return const AdBannerWidget();
                }
                final entry = posts[index ~/ 2];
                return PredictionCard(
                  p: entry, 
                  entry: entry, 
                  isAdmin: isAdmin, 
                  tier: 'free',
                  isUnlocked: _unlockedPredictions.contains(entry['id'].toString()),
                  onUnlock: () => _unlockPrediction(entry['id'].toString()),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class FreePredictionAdminForm extends StatefulWidget {
  const FreePredictionAdminForm({super.key});

  @override
  State<FreePredictionAdminForm> createState() => _FreePredictionAdminFormState();
}

class _FreePredictionAdminFormState extends State<FreePredictionAdminForm> {
  final _formKey = GlobalKey<FormState>();
  final _homeTeamController = TextEditingController();
  final _awayTeamController = TextEditingController();
  final _matchUrlController = TextEditingController();
  final _predictionTypeController = TextEditingController();
  final _oddsController = TextEditingController();
  String _confidence = '95%';
  DateTime? _matchStartTime;
  bool _loading = false;

  Future<void> _publishPost() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() { _loading = true; });
    // Convert Nigeria time (UTC+1) to UTC for storage
    final utcTime = _matchStartTime?.subtract(const Duration(hours: 1)).toIso8601String() ?? DateTime.now().toUtc().toIso8601String();
    await Supabase.instance.client.from('predictions').insert({
      'home_team': _homeTeamController.text,
      'away_team': _awayTeamController.text,
      'match_start_time': utcTime,
      'match_url': _matchUrlController.text,
      'prediction_type': _predictionTypeController.text,
      'odds': _oddsController.text,
      'confidence': _confidence,
      'is_free': true,
      // 'tier' can be null for free predictions
    });
    

    
    if (mounted) {
      Navigator.of(context).pop();
    }
    setState(() { _loading = false; });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Publish Free Prediction', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 16),
              TextFormField(controller: _homeTeamController, decoration: const InputDecoration(labelText: 'Home Team'), validator: (v) => v!.isEmpty ? 'Required' : null),
              TextFormField(controller: _awayTeamController, decoration: const InputDecoration(labelText: 'Away Team'), validator: (v) => v!.isEmpty ? 'Required' : null),
              ListTile(
                title: Text(_matchStartTime == null ? 'Pick Match Start Time' : DateFormat('MMM d, h:mm a').format(_matchStartTime!)),
                trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final picked = await showDatePicker(context: context, initialDate: DateTime.now(), firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 365)));
                  if (picked != null) {
                    final time = await showTimePicker(context: context, initialTime: TimeOfDay.now());
                    if (time != null) setState(() => _matchStartTime = DateTime(picked.year, picked.month, picked.day, time.hour, time.minute));
                  }
                },
              ),
              TextFormField(controller: _matchUrlController, decoration: const InputDecoration(labelText: 'Match Watch URL (optional)')),
              TextFormField(controller: _predictionTypeController, decoration: const InputDecoration(labelText: 'Prediction Type'), validator: (v) => v!.isEmpty ? 'Required' : null),
              TextFormField(controller: _oddsController, decoration: const InputDecoration(labelText: 'Betting Odds'), validator: (v) => v!.isEmpty ? 'Required' : null),
              DropdownButton<String>(
                value: _confidence,
                items: ['95%', '97%', '98%', '99%'].map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: (v) => setState(() { _confidence = v ?? '95%'; }),
              ),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _loading ? null : _publishPost, child: _loading ? const CircularProgressIndicator() : const Text('Publish')),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
    await Supabase.instance.client.auth.signOut();
    if (context.mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AuthScreen()),
        (route) => false,
      );
    }
  }

  Future<void> _deleteAccount(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Account'),
        content: const Text('Are you sure you want to permanently delete your account? This action cannot be undone and will remove all your data.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      try {
        final user = Supabase.instance.client.auth.currentUser;
        if (user != null) {
          // Delete user profile data
          await Supabase.instance.client.from('profiles').delete().eq('id', user.id);
          // Delete user messages
          await Supabase.instance.client.from('community_messages').delete().eq('user_id', user.id);
          await Supabase.instance.client.from('prediction_comments').delete().eq('user_id', user.id);
          // Delete auth user
          await Supabase.instance.client.auth.admin.deleteUser(user.id);
        }
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Account deleted successfully')),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Failed to delete account. Please contact support.')),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Profile & Settings')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            ListTile(
              leading: const Icon(Icons.person),
              title: Text(userProfile?.username ?? 'Loading...'),
              subtitle: const Text('Username'),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.policy_outlined, color: Colors.grey),
              title: const Text('Privacy Policy'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyPolicyScreen())),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.delete_forever, color: Colors.red),
              title: const Text('Delete Account'),
              subtitle: const Text('Permanently delete your account and all data'),
              onTap: () => _deleteAccount(context),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.orange),
              title: const Text('Log Out'),
              onTap: () => _signOut(context),
            ),
          ],
        ),
      ),
    );
  }
}

class FreePostCommentScreen extends StatefulWidget {
  final String postId;
  const FreePostCommentScreen({required this.postId, super.key});

  @override
  State<FreePostCommentScreen> createState() => _FreePostCommentScreenState();
}

class _FreePostCommentScreenState extends State<FreePostCommentScreen> {
  final TextEditingController _msgController = TextEditingController();
  late final Stream<List<Map<String, dynamic>>> _commentStream;

  @override
  void initState() {
    super.initState();
    _commentStream = Supabase.instance.client
        .from('prediction_comments')
        .stream(primaryKey: ['id'])
        .eq('prediction_id', widget.postId)
        .order('created_at');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Comments')),
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<List<Map<String, dynamic>>>(
              stream: _commentStream,
              builder: (context, snapshot) {
                if (!snapshot.hasData || snapshot.data!.isEmpty) {
                  return const Center(child: Text('No comments yet.'));
                }
                final messages = snapshot.data!;
                return ListView.builder(
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[index];
                    return ListTile(
                      title: Text(msg['username'] ?? 'User'),
                      subtitle: Text(msg['text'] ?? ''),
                      trailing: Text(DateFormat.yMd().add_jm().format(DateTime.parse(msg['created_at'])), style: Theme.of(context).textTheme.bodySmall),
                    );
                  },
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _msgController,
                    decoration: const InputDecoration(hintText: 'Add a comment...'),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: () {
                    final text = _msgController.text.trim();
                    final userProfile = Provider.of<UserProfile?>(context, listen: false);
                    final user = Supabase.instance.client.auth.currentUser;
                    if (text.isNotEmpty && user != null) {
                      _msgController.clear();
                      setState(() {});
                      Supabase.instance.client.from('prediction_comments').insert({
                        'prediction_id': widget.postId,
                        'user_id': user.id,
                        'username': userProfile?.username ?? 'Anonymous', 
                        'text': text
                      });
                    }
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class VIPPredictionsWidget extends StatefulWidget {
  const VIPPredictionsWidget({super.key});
  @override
  State<VIPPredictionsWidget> createState() => _VIPPredictionsWidgetState();
}

class _VIPPredictionsWidgetState extends State<VIPPredictionsWidget> {
  final List<String> tiers = ['Basic', 'Standard', 'Premium', 'Ultra VIP'];
  final List<String> prices = ['2.99', '9.99', '24.99', '49.99'];
  final List<String> productIds = ['vip_basic', 'vip_standard', 'vip_premium', 'vip_ultra'];
  int? _loadingTierIndex;



  final List<Map<String, String>> tierDetails = [
    {
      'name': 'Basic',
      'price': '\$2.99',
      'accuracy': '95% Accuracy',
      'frequency': '3 Predictions/Week',
      'features': '• Access to exclusive AI-powered football predictions\n• Community chat for each prediction\n• Match details, odds, and confidence level',
    },
    {
      'name': 'Standard',
      'price': '\$9.99',
      'accuracy': '97% Accuracy',
      'frequency': '6 Predictions/Week',
      'features': '• Access to exclusive AI-powered football predictions\n• Community chat for each prediction\n• Match details, odds, and confidence level',
    },
    {
      'name': 'Premium',
      'price': '\$24.99',
      'accuracy': '98% Accuracy',
      'frequency': 'Daily Predictions',
      'features': '• Access to exclusive AI-powered football predictions\n• Community chat for each prediction\n• Match details, odds, and confidence level',
    },
    {
      'name': 'Ultra VIP',
      'price': '\$49.99',
      'accuracy': '99% Accuracy',
      'frequency': 'Daily Predictions',
      'features': '• Access to exclusive AI-powered football predictions\n• Community chat for each prediction\n• Match details, odds, and confidence level\n• Priority support for Ultra VIP',
    },
  ];

  Future<void> _payForTier(int tierIndex) async {
    setState(() { _loadingTierIndex = tierIndex; });
    final bool available = await InAppPurchase.instance.isAvailable(); 
    if (!available) {
      if (mounted) {
        setState(() { _loadingTierIndex = null; });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('In-app purchases not available')));
      }
      return;
    }
    final ProductDetailsResponse response = await InAppPurchase.instance.queryProductDetails({productIds[tierIndex]});
    if (response.productDetails.isEmpty) {
      if (mounted) {
        setState(() { _loadingTierIndex = null; });
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Product not found')));
      }
      return;
    }
    final ProductDetails productDetails = response.productDetails.first;
    final PurchaseParam purchaseParam = PurchaseParam(productDetails: productDetails);
    AnalyticsService.logEvent('vip_purchase_initiated', parameters: {
      'tier': tiers[tierIndex],
      'price': prices[tierIndex],
    });
    InAppPurchase.instance.buyNonConsumable(purchaseParam: purchaseParam);
    if (mounted) {
      setState(() { _loadingTierIndex = null; });
    }
  }

  @override
  void initState() {
    super.initState();

  }





  @override
  void dispose() {

    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context);
    final userTier = userProfile?.vipTier ?? 0;
    return Scaffold(
      appBar: AppBar(
        title: const Text('VIP Tiers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.account_circle),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
          ),
        ],
      ),
      body: ListView.builder(
        itemCount: tiers.length,
        itemBuilder: (context, i) {
          final tier = tierDetails[i]; 
          final isLoading = _loadingTierIndex == i;
          final isPremium = tier['name'] == 'Premium';
          return Card(
            elevation: isPremium ? 8 : 4,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: isPremium ? BorderSide(color: Theme.of(context).colorScheme.primary, width: 2) : BorderSide.none,
            ),
            margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: IntrinsicHeight(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      color: Theme.of(context).cardColor.withValues(alpha: 0.5),
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          if (isPremium)
                            const Chip(label: Text('Best Value'), backgroundColor: Colors.orange),
                          Text('${tier['name']} VIP', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                          Text(tier['price']!, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: const Color(0xFF8892B0))),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          ListTile(leading: const Icon(Icons.check_circle_outline, color: Color(0xFF64FFDA)), title: Text(tier['accuracy']!)),
                          ListTile(leading: const Icon(Icons.calendar_today_outlined, color: Color(0xFF64FFDA)), title: Text(tier['frequency']!)),
                          const Divider(height: 24),
                          Text(tier['features'] ?? '', style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.5)),
                        ],
                      ),
                    ),
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: (userTier > i || (userProfile?.isAdmin ?? false))
                        ? ElevatedButton.icon(
                            icon: const Icon(Icons.lock_open),
                            label: const Text('Access'),
                            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MainScreen(initialTab: 2, vipTier: tiers[i].toLowerCase().replaceAll(' ', '_'), vipTierName: tiers[i]))),
                            style: ElevatedButton.styleFrom(backgroundColor: Colors.green, minimumSize: const Size(double.infinity, 50)),
                          )
                        : ElevatedButton(
                            onPressed: _loadingTierIndex != null ? null : () => _payForTier(i),
                            style: ElevatedButton.styleFrom(minimumSize: const Size(double.infinity, 50)),
                            child: isLoading ? const CircularProgressIndicator() : const Text('Upgrade'),
                          ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class VIPTierPredictionsList extends StatelessWidget {
  final String tier;
  final String tierName;
  const VIPTierPredictionsList({required this.tier, required this.tierName, super.key});

  @override
  Widget build(BuildContext context) {
    final vipStream = Supabase.instance.client
        .from('predictions')
        .stream(primaryKey: ['id'])
        .eq('tier', tier)
        .order('created_at', ascending: false);
    final userProfile = Provider.of<UserProfile?>(context);
    final isAdmin = userProfile?.isAdmin ?? false;
    return Scaffold(
      appBar: AppBar(
        title: Text('$tierName Predictions'),
        actions: [
          if (isAdmin)
            IconButton(
              icon: const Icon(Icons.add_circle_outline),
              onPressed: () {
                HapticFeedback.lightImpact();
                showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => VIPAdminForm(tier: tier.toLowerCase()),
                );
              },
            ),
          IconButton(
            icon: const Icon(Icons.account_circle),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
          ),
        ],
      ),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: vipStream,
        builder: (context, snapshot) {
          if (!snapshot.hasData || snapshot.data!.isEmpty) {
            return const Center(child: Text('No predictions yet.'));
          }
          final predictions = snapshot.data!;
          return ListView.builder(
            itemCount: predictions.length + predictions.length,
            itemBuilder: (context, index) {
              if (index.isOdd) {
                return const AdBannerWidget();
              }
              final entry = predictions[index ~/ 2];
              return PredictionCard(p: entry, entry: entry, isAdmin: isAdmin, tier: tier);
            },
          );
        },
      ),
    );
  }
}

class PredictionCard extends StatefulWidget {
  const PredictionCard({
    super.key,
    required this.p,
    required this.entry,
    required this.isAdmin,
    required this.tier,
    this.isUnlocked = true,
    this.onUnlock,
  });

  final Map<dynamic, dynamic> p;
  final Map<String, dynamic> entry;
  final bool isAdmin;
  final String tier;
  final bool isUnlocked;
  final VoidCallback? onUnlock;

  @override
  State<PredictionCard> createState() => _PredictionCardState();
}

class _PredictionCardState extends State<PredictionCard> {
  Timer? _timer;
  String _timeDisplay = '';
  String _statusText = '';
  Color _statusColor = Colors.grey;

  @override
  void initState() {
    super.initState();
    _updateStatus();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _updateStatus());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _updateStatus() {
    final matchTime = DateTime.parse(widget.p['match_start_time']).toLocal();
    final now = DateTime.now();
    final result = widget.p['result'];
    
    if (result != null) {
      setState(() {
        _statusText = 'Finished';
        _statusColor = Colors.grey;
        _timeDisplay = DateFormat('MMM d, h:mm a').format(matchTime);
      });
      return;
    }
    
    if (now.isBefore(matchTime)) {
      final diff = matchTime.difference(now);
      setState(() {
        _statusText = 'Pending';
        _statusColor = Colors.orange;
        if (diff.inMinutes <= 15) {
          // Show countdown only when 15 minutes or less
          _timeDisplay = '${diff.inMinutes}m ${diff.inSeconds % 60}s';
        } else {
          // Show scheduled time when more than 15 minutes
          _timeDisplay = DateFormat('MMM d, h:mm a').format(matchTime);
        }
      });
    } else if (now.isBefore(matchTime.add(const Duration(minutes: 110)))) {
      final elapsed = now.difference(matchTime);
      setState(() {
        _statusText = 'Live';
        _statusColor = Colors.green;
        _timeDisplay = '${elapsed.inMinutes}\' Live';
      });
    } else {
      setState(() {
        _statusText = 'Finished';
        _statusColor = Colors.grey;
        _timeDisplay = DateFormat('MMM d, h:mm a').format(matchTime);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = widget.p['result'];

    return Card(
      clipBehavior: Clip.antiAlias,
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(_timeDisplay),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(color: _statusColor, borderRadius: BorderRadius.circular(12)),
                      child: Text(_statusText, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(children: [const Icon(Icons.shield_outlined, size: 40), Text(widget.p['home_team'] ?? 'N/A', textAlign: TextAlign.center)]),
                    Text('vs', style: Theme.of(context).textTheme.headlineSmall),
                    Column(children: [const Icon(Icons.shield_outlined, size: 40), Text(widget.p['away_team'] ?? 'N/A', textAlign: TextAlign.center)]),
                  ],
                ),
                const Divider(height: 24),
                Stack(
                  children: [
                    Column(
                      children: [
                        ListTile(
                          title: Text(widget.p['prediction_type'] ?? 'N/A', style: Theme.of(context).textTheme.titleLarge),
                          subtitle: Text('Odds: ${widget.p['odds'] ?? 'N/A'}'),
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(widget.p['confidence'] ?? 'N/A', style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Theme.of(context).colorScheme.primary)),
                              const Text('Confidence'),
                            ],
                          ),
                        ),
                        const Divider(height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            if (widget.p['match_url'] != null && widget.p['match_url'].isNotEmpty)
                              TextButton.icon(
                                icon: const Icon(Icons.play_circle_outline),
                                label: const Text('Watch Live'),
                                onPressed: () {
                                  HapticFeedback.lightImpact();
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text('Watch URL: ${widget.p['match_url']}')),
                                  );
                                },
                              ),
                            TextButton.icon( 
                              icon: const Icon(Icons.chat_bubble_outline),
                              label: const Text('Discuss'),
                              onPressed: () {
                                HapticFeedback.lightImpact();
                                Navigator.of(context).push(MaterialPageRoute(builder: (_) => PredictionChatScreen(predictionId: widget.entry['id'].toString(), tier: widget.tier)));
                              },
                            ),
                            if (widget.isAdmin)
                              PopupMenuButton<String>(
                                onSelected: (value) async {
                                  if (value == 'Clear') {
                                    await Supabase.instance.client.from('predictions').update({'result': null}).eq('id', widget.entry['id']);
                                  } else {
                                    await Supabase.instance.client.from('predictions').update({'result': value}).eq('id', widget.entry['id']);
                                  }
                                },
                                itemBuilder: (context) => [
                                  const PopupMenuItem(value: 'Win', child: Text('Mark as Win')),
                                  const PopupMenuItem(value: 'Lost', child: Text('Mark as Lost')),
                                  const PopupMenuItem(value: 'Clear', child: Text('Clear Result')),
                                ],
                                child: const Row(children: [Icon(Icons.edit), SizedBox(width: 4), Text('Result')]),
                              ),
                          ],
                        ),
                      ],
                    ),
                    if (widget.tier == 'free' && !widget.isUnlocked)
                      Positioned.fill(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: BackdropFilter(
                            filter: ImageFilter.blur(sigmaX: 15.0, sigmaY: 15.0),
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.black.withValues(alpha: 0.8),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Center(
                                child: ElevatedButton.icon(
                                  icon: const Icon(Icons.play_arrow),
                                  label: const Text('Watch Ads to Unlock Prediction'),
                                  onPressed: () {
                                    AnalyticsService.logEvent('rewarded_ad_requested', parameters: {
                                      'prediction_id': widget.entry['id'].toString(),
                                      'tier': 'free',
                                    });
                                    RewardedAdManager.showAd(() {
                                      AnalyticsService.logEvent('rewarded_ad_completed', parameters: {
                                        'prediction_id': widget.entry['id'].toString(),
                                      });
                                      widget.onUnlock?.call();
                                    });
                                  },
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (result != null)
            Positioned(
              top: 120,
              left: 16,
              right: 16,
              bottom: 120,
              child: Container(
                decoration: BoxDecoration(
                  color: result == 'Win' ? Colors.green.withValues(alpha: 0.8) : Colors.red.withValues(alpha: 0.8),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(
                  child: Text(result, style: Theme.of(context).textTheme.displayMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class PredictionChatScreen extends StatefulWidget {
  final String predictionId;
  final String tier;
  const PredictionChatScreen({required this.predictionId, required this.tier, super.key});
  @override
  State<PredictionChatScreen> createState() => _PredictionChatScreenState();
}

class _PredictionChatScreenState extends State<PredictionChatScreen> {
  final TextEditingController _msgController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, dynamic>> _localMessages = [];

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _msgController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Prediction Chat')), 
      body: Column(
        children: [
          Expanded(
            child: StreamBuilder<List<Map<String, dynamic>>>(
              stream: Supabase.instance.client
                  .from('prediction_comments')
                  .stream(primaryKey: ['id'])
                  .eq('prediction_id', widget.predictionId)
                  .order('created_at', ascending: true),
              builder: (context, snapshot) {
                final dbMessages = snapshot.data ?? [];
                final allMessages = [...dbMessages, ..._localMessages];
                
                if (allMessages.isEmpty) {
                  return const Center(child: Text('No messages yet.'));
                }
                final messages = allMessages;
                
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (_scrollController.hasClients) {
                    _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
                  }
                });
                
                return ListView.builder(
                  controller: _scrollController,
                  itemCount: messages.length + (messages.length ~/ 2),
                  itemBuilder: (context, index) {
                    if ((index + 1) % 3 == 0) {
                      return const AdBannerWidget();
                    }
                    final messageIndex = index - (index ~/ 3);
                    if (messageIndex >= messages.length) return const SizedBox.shrink();
                    final msg = messages[messageIndex];
                    final currentUser = Supabase.instance.client.auth.currentUser;
                    final isMe = msg['user_id'] == currentUser?.id;
                    
                    final timestamp = DateTime.parse(msg['created_at']);
                    final timeStr = DateFormat('h:mm a').format(timestamp);
                    final dateStr = DateFormat('MMM d').format(timestamp);
                    
                    return Container(
                      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
                        decoration: BoxDecoration(
                          color: isMe ? Theme.of(context).colorScheme.primary : Theme.of(context).cardColor,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Column(
                          crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (!isMe) Text(msg['username'] ?? 'User', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, color: Theme.of(context).colorScheme.primary)),
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Flexible(child: Text(msg['text'] ?? '', style: TextStyle(color: isMe ? Colors.black : Colors.white))),
                                const SizedBox(width: 8),
                                Text('$dateStr $timeStr', style: TextStyle(fontSize: 10, color: isMe ? Colors.black54 : Colors.white54)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _msgController,
                  decoration: const InputDecoration(hintText: 'Type a message...'),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.send),
                onPressed: () {
                  final text = _msgController.text.trim();
                  final userProfile = Provider.of<UserProfile?>(context, listen: false); 
                  final user = Supabase.instance.client.auth.currentUser;
                  if (text.isNotEmpty && user != null) {
                    _msgController.clear();
                    
                    // Add message instantly to local list
                    final newMessage = {
                      'id': DateTime.now().millisecondsSinceEpoch.toString(),
                      'user_id': user.id,
                      'username': userProfile?.username ?? 'Anonymous',
                      'text': text,
                      'created_at': DateTime.now().toIso8601String(),
                    };
                    
                    setState(() {
                      _localMessages.add(newMessage);
                    });
                    
                    // Save to database in background
                    Supabase.instance.client.from('prediction_comments').insert({
                      'prediction_id': widget.predictionId,
                      'user_id': user.id,
                      'username': userProfile?.username ?? 'Anonymous',
                      'text': text
                    }).then((_) {
                      // Remove from local list once saved to DB
                      setState(() {
                        _localMessages.removeWhere((msg) => msg['id'] == newMessage['id']);
                      });
                    });
                    
                    Future.delayed(const Duration(milliseconds: 100), () {
                      if (_scrollController.hasClients) {
                        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
                      }
                    });
                  }
                },
              ),
            ],
          ),
        ],
      ),
    );
  }
}
class AdminScreen extends StatelessWidget {
  const AdminScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
    await Supabase.instance.client.auth.signOut();
    if (context.mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const AuthScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final userProfile = Provider.of<UserProfile?>(context);
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Panel'),
        actions: [
          IconButton(
            icon: const Icon(Icons.account_circle),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen())),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const Icon(Icons.person, color: Color(0xFF64FFDA)),
              title: Text(userProfile?.username ?? 'Admin'),
              subtitle: const Text('Administrator'),
              trailing: const Icon(Icons.admin_panel_settings, color: Colors.orange),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Prediction Management', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Card(
            child: ListTile(
              leading: const Icon(Icons.add_circle, color: Color(0xFF64FFDA)),
              title: const Text('Add Free Prediction'),
              onTap: () => showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                builder: (_) => const FreePredictionAdminForm(),
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.star, color: Colors.orange),
              title: const Text('Manage VIP Predictions'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const VIPManagementScreen())),
            ),
          ),
          const SizedBox(height: 16),
          const Text('User Management', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Card(
            child: ListTile(
              leading: const Icon(Icons.people, color: Color(0xFF64FFDA)),
              title: const Text('View Users'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const UserManagementScreen())),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.chat, color: Color(0xFF64FFDA)),
              title: const Text('Moderate Community'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CommunityScreen())),
            ),
          ),
          const SizedBox(height: 16),
          const Text('Settings', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Card(
            child: ListTile(
              leading: const Icon(Icons.policy, color: Colors.grey),
              title: const Text('Privacy Policy'),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const PrivacyPolicyScreen())),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.logout, color: Colors.red),
              title: const Text('Logout'),
              onTap: () => _signOut(context),
            ),
          ),
        ],
      ),
    );
  }
}

class VIPManagementScreen extends StatelessWidget {
  const VIPManagementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tiers = ['basic', 'standard', 'premium', 'ultra_vip'];
    final tierNames = ['Basic', 'Standard', 'Premium', 'Ultra VIP'];
    
    return Scaffold(
      appBar: AppBar(title: const Text('VIP Management')),
      body: ListView.builder(
        itemCount: tiers.length,
        itemBuilder: (context, index) {
          return Card(
            margin: const EdgeInsets.all(8),
            child: ListTile(
              leading: const Icon(Icons.star, color: Colors.orange),
              title: Text('${tierNames[index]} Predictions'),
              trailing: const Icon(Icons.arrow_forward_ios),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => MainScreen(initialTab: 2, vipTier: tiers[index], vipTierName: tierNames[index]),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class UserManagementScreen extends StatelessWidget {
  const UserManagementScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('User Management')),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: Supabase.instance.client
            .from('profiles')
            .stream(primaryKey: ['id'])
            .order('created_at'),
        builder: (context, snapshot) {
          if (!snapshot.hasData || snapshot.data!.isEmpty) {
            return const Center(child: Text('No users found.'));
          }
          final users = snapshot.data!;
          return ListView.builder(
            itemCount: users.length,
            itemBuilder: (context, index) {
              final user = users[index];
              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    child: Text(user['username']?[0]?.toUpperCase() ?? 'U'),
                  ),
                  title: Text(user['username'] ?? 'Unknown'),
                  subtitle: Text('VIP Tier: ${user['vip_tier'] ?? 0} ${user['role'] == 'admin' ? '• Admin' : ''}'),
                  trailing: PopupMenuButton<String>(
                    onSelected: (value) async {
                      if (value == 'toggle_admin') {
                        final newRole = user['role'] == 'admin' ? 'user' : 'admin';
                        await Supabase.instance.client.from('profiles').update({
                          'role': newRole
                        }).eq('id', user['id']);
                      }
                    },
                    itemBuilder: (context) => [
                      PopupMenuItem(
                        value: 'toggle_admin',
                        child: Text(user['role'] == 'admin' ? 'Remove Admin' : 'Make Admin'),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class VIPAdminForm extends StatefulWidget {
  final String tier;
  const VIPAdminForm({required this.tier, super.key});
  @override
  State<VIPAdminForm> createState() => _VIPAdminFormState();
}

class _VIPAdminFormState extends State<VIPAdminForm> {
  final TextEditingController _homeTeamController = TextEditingController();
  final TextEditingController _awayTeamController = TextEditingController();
  final TextEditingController _matchUrlController = TextEditingController();
  final TextEditingController _predictionTypeController = TextEditingController();
  final TextEditingController _oddsController = TextEditingController();
  String confidence = '95%';
  DateTime? matchStartTime;
  bool loading = false;

  Future<void> _publishPrediction() async {
    setState(() { loading = true; });
    // Convert Nigeria time (UTC+1) to UTC for storage
    final utcTime = matchStartTime?.subtract(const Duration(hours: 1)).toIso8601String() ?? DateTime.now().toUtc().toIso8601String();
    await Supabase.instance.client.from('predictions').insert({
      'home_team': _homeTeamController.text,
      'away_team': _awayTeamController.text,
      'match_start_time': utcTime,
      'match_url': _matchUrlController.text,
      'prediction_type': _predictionTypeController.text,
      'odds': _oddsController.text,
      'confidence': confidence,
      'is_free': false,
      'tier': widget.tier,
    });
    

    
    if (mounted) {
      setState(() { loading = false; });
      Navigator.of(context).pop();
    }
    _homeTeamController.clear();
    _awayTeamController.clear();
    _matchUrlController.clear();
    _predictionTypeController.clear();
    _oddsController.clear();
    confidence = '95%';
    matchStartTime = null;
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _homeTeamController,
              decoration: const InputDecoration(labelText: 'Home Team'),
            ),
            TextField(
              controller: _awayTeamController,
              decoration: const InputDecoration(labelText: 'Away Team'),
            ),
            ListTile(
              title: Text(matchStartTime == null
                  ? 'Pick Match Start Time'
                  : DateFormat('MMM d, h:mm a').format(matchStartTime!)),
              trailing: const Icon(Icons.calendar_today),
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: DateTime.now(),
                  firstDate: DateTime.now().subtract(const Duration(days: 1)),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (picked != null) {
                  if (mounted) { // Added mounted check
                    final time = await showTimePicker(
                      context: context,
                      initialTime: TimeOfDay.now(),
                    );
                    if (time != null) {
                      setState(() {
                        matchStartTime = DateTime(
                          picked.year,
                          picked.month,
                          picked.day,
                          time.hour,
                          time.minute,
                        );
                      });
                    }
                  }
                }
              },
            ),
            TextField(
              controller: _matchUrlController,
              decoration: const InputDecoration(labelText: 'Match Watch URL (optional)'),
            ),
            TextField(
              controller: _predictionTypeController,
              decoration: const InputDecoration(labelText: 'Prediction Type'),
            ),
            TextField(
              controller: _oddsController,
              decoration: const InputDecoration(labelText: 'Betting Odds'),
            ),
            DropdownButton<String>(
              value: confidence,
              items: ['95%', '97%', '98%', '99%']
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
              onChanged: (v) => setState(() { confidence = v ?? '95%'; }),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: loading ? null : _publishPrediction,
              child: loading ? const CircularProgressIndicator() : const Text('Publish'),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}
