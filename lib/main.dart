import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';
import 'ad_gate_service.dart';
import 'appwrite_subscription_service.dart';
import 'feed_banner_ad.dart';
import 'google_play_billing_service.dart';
import 'prediction_repository.dart';
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
  } catch (error) {
    debugPrint('Push subscription failed: $error');
    // Push subscription issues should not block the prediction feed.
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI Football Prediction',
      builder: (context, child) {
        final scaledChild = child ?? const SizedBox.shrink();
        return MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(1.15)),
          child: scaledChild,
        );
      },
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00C2A8),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF07111F),
        textTheme: ThemeData.dark().textTheme,
      ),
      home: const NotificationBootstrapPage(),
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
    } catch (error) {
      debugPrint('Push subscription failed: $error');
    }

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
    _setIndex(2);
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: GooglePlayBillingService.instance,
      builder: (context, _) {
        final adFree = GooglePlayBillingService.instance.hasAdFreeAccess;

        return Scaffold(
          body: IndexedStack(
            index: _currentIndex,
            children: [
              _PredictionHomeTab(
                adFree: adFree,
                selectedCount: _selectedItems.length,
                isPredictionSelected: (prediction) => _selectedPredictions
                    .containsKey(_predictionUnlockKey(prediction)),
                onToggleSelection: _toggleSelectedPrediction,
                onOpenPicked: _openPickedTab,
              ),
              PremiumPlanPage(
                adFree: adFree,
                currentPlans: GooglePlayBillingService.instance.plans,
              ),
              PickedMatchesPage(
                selectedPredictions: _selectedItems,
                onClearAll: _selectedItems.isEmpty ? null : _clearSelections,
              ),
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
              NavigationBar(
                selectedIndex: _currentIndex,
                onDestinationSelected: _setIndex,
                backgroundColor: const Color(0xFF081221),
                indicatorColor: const Color(0xFF00D4AA).withAlpha(40),
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.home_outlined),
                    selectedIcon: Icon(Icons.home),
                    label: 'Home',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.workspace_premium_outlined),
                    selectedIcon: Icon(Icons.workspace_premium),
                    label: 'Premium Plan',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.fact_check_outlined),
                    selectedIcon: Icon(Icons.fact_check),
                    label: 'Picked',
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

enum _ConfidenceFilter { all, high, medium }

extension _ConfidenceFilterX on _ConfidenceFilter {
  String get label => switch (this) {
    _ConfidenceFilter.all => 'All',
    _ConfidenceFilter.high => 'High',
    _ConfidenceFilter.medium => 'Medium',
  };
}

class _PredictionHomeTab extends StatefulWidget {
  const _PredictionHomeTab({
    required this.adFree,
    required this.selectedCount,
    required this.isPredictionSelected,
    required this.onToggleSelection,
    required this.onOpenPicked,
  });

  final bool adFree;
  final int selectedCount;
  final bool Function(PredictionRecord prediction) isPredictionSelected;
  final void Function(PredictionRecord prediction) onToggleSelection;
  final VoidCallback onOpenPicked;

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

    return queryMatch && confidenceMatch;
  }

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

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF07111F), Color(0xFF0B1D35), Color(0xFF122B4A)],
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
              backgroundColor: const Color(0xFF0D1B2D),
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverAppBar(
                    pinned: true,
                    floating: false,
                    toolbarHeight: 72,
                    backgroundColor: const Color(0xFF0A1220).withAlpha(248),
                    surfaceTintColor: Colors.transparent,
                    elevation: 0,
                    titleSpacing: 20,
                    title: const _StickyHeader(),
                    flexibleSpace: Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Color(0xFF07111F),
                            Color(0xFF0D223A),
                            Color(0xFF123652),
                          ],
                          begin: Alignment.centerLeft,
                          end: Alignment.centerRight,
                        ),
                      ),
                    ),
                    actions: [
                      Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: IconButton(
                          tooltip: 'Policy',
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => const PolicyPage(),
                              ),
                            );
                          },
                          icon: const Icon(Icons.menu),
                          color: const Color(0xFFB8D5FF),
                        ),
                      ),
                    ],
                  ),
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          TextField(
                            onChanged: (value) {
                              setState(() {
                                _searchQuery = value;
                              });
                            },
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: 'Search teams, status, time',
                              hintStyle: const TextStyle(
                                color: Color(0xFF84D6FF),
                              ),
                              prefixIcon: const Icon(Icons.search),
                              filled: true,
                              fillColor: const Color(0xFF0D1B2D),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(18),
                                borderSide: BorderSide.none,
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(18),
                                borderSide: const BorderSide(
                                  color: Color(0xFF20364E),
                                ),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(18),
                                borderSide: const BorderSide(
                                  color: Color(0xFF00D4AA),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: _ConfidenceFilter.values.map((filter) {
                              final isSelected = filter == _confidenceFilter;
                              return ChoiceChip(
                                label: Text(filter.label),
                                selected: isSelected,
                                onSelected: (_) {
                                  setState(() {
                                    _confidenceFilter = filter;
                                  });
                                },
                                selectedColor: const Color(0xFF00D4AA),
                                labelStyle: TextStyle(
                                  color: isSelected
                                      ? const Color(0xFF07111F)
                                      : Colors.white,
                                  fontWeight: FontWeight.w700,
                                ),
                                backgroundColor: const Color(0xFF0D1B2D),
                                side: const BorderSide(
                                  color: Color(0xFF20364E),
                                ),
                              );
                            }).toList(),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (snapshot.connectionState == ConnectionState.waiting &&
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

class PremiumPlanPage extends StatelessWidget {
  const PremiumPlanPage({
    super.key,
    required this.adFree,
    required this.currentPlans,
  });

  final bool adFree;
  final List<SubscriptionPlanId> currentPlans;

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

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: GooglePlayBillingService.instance,
      builder: (context, _) {
        final billing = GooglePlayBillingService.instance;
        return Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [Color(0xFF07111F), Color(0xFF0B1D35), Color(0xFF122B4A)],
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
            ),
          ),
          child: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              children: [
                const Text(
                  'Premium Plans',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  adFree
                      ? 'Your account is ad-free. Thanks for supporting the app.'
                      : 'Choose a plan and pay through Google Play Billing to remove all ads.',
                  style: const TextStyle(
                    color: Color(0xFFB8D5FF),
                    fontSize: 14,
                    height: 1.5,
                  ),
                ),
                if (!billing.isAvailable) ...[
                  const SizedBox(height: 16),
                  _planNotice(
                    title: 'Billing unavailable',
                    body:
                        'Google Play Billing is not available on this device or the store connection has not been configured yet.',
                  ),
                ],
                if (billing.errorMessage != null) ...[
                  const SizedBox(height: 16),
                  _planNotice(
                    title: 'Billing setup note',
                    body: billing.errorMessage!,
                  ),
                ],
                const SizedBox(height: 18),
                ...currentPlans.map((plan) {
                  final product = billing.productFor(plan);
                  final price = product?.price ?? plan.fallbackPrice;
                  final owned = billing.isOwned(plan);

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: _SubscriptionPlanCard(
                      title: plan.title,
                      price: price,
                      subtitle: plan.subtitle,
                      highlight: owned || adFree,
                      featureLines: const [
                        'Remove all ads',
                        'Unlock a cleaner experience',
                        'Works across the full app',
                      ],
                      buttonLabel: owned || adFree
                          ? 'Active'
                          : 'Buy on Google Play',
                      onPressed: owned || adFree
                          ? null
                          : () => _buyPlan(context, plan),
                    ),
                  );
                }),
                const SizedBox(height: 8),
                FilledButton.tonalIcon(
                  onPressed: billing.restorePurchases,
                  icon: const Icon(Icons.restore),
                  label: const Text('Restore purchases'),
                ),
              ],
            ),
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
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF07111F), Color(0xFF0B1D35), Color(0xFF122B4A)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Picked Matches',
                    style: TextStyle(
                      color: Colors.white,
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
            const SizedBox(height: 8),
            const Text(
              'All selected matches are arranged below in table form.',
              style: TextStyle(
                color: Color(0xFFB8D5FF),
                fontSize: 14,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 18),
            if (selectedPredictions.isEmpty)
              const _EmptyState(
                icon: Icons.fact_check_outlined,
                title: 'No picked matches yet',
                message: 'Select an unlocked match from Home to see it here.',
              )
            else
              Container(
                decoration: BoxDecoration(
                  color: const Color(0xFF0D1B2D),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFF20364E)),
                ),
                padding: const EdgeInsets.all(12),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    headingRowColor: const WidgetStatePropertyAll(
                      Color(0xFF10253E),
                    ),
                    dataRowColor: const WidgetStatePropertyAll(
                      Color(0xFF0D1B2D),
                    ),
                    columns: const [
                      DataColumn(label: Text('Match')),
                      DataColumn(label: Text('Time')),
                      DataColumn(label: Text('Confidence')),
                      DataColumn(label: Text('Selection')),
                      DataColumn(label: Text('Status')),
                    ],
                    rows: selectedPredictions.map((prediction) {
                      return DataRow(
                        cells: [
                          DataCell(
                            Text(
                              '${prediction.homeTeamName ?? 'Home'} vs ${prediction.awayTeamName ?? 'Away'}',
                            ),
                          ),
                          DataCell(
                            Text(
                              _formatTimeOnly(
                                prediction.kickoffAt ?? prediction.releaseAt,
                              ),
                            ),
                          ),
                          DataCell(
                            Text(
                              _confidenceBadgeLabel(prediction).toUpperCase(),
                            ),
                          ),
                          DataCell(
                            Text(
                              finalSelection(
                                _PickCardData.fromPick(
                                  'Primary pick',
                                  prediction.primaryPick,
                                  const Color(0xFF00D4AA),
                                  prediction,
                                ),
                              ),
                            ),
                          ),
                          DataCell(Text(_matchStatusLabel(prediction))),
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
    return Material(
      color: const Color(0xFF0B1626),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: Color(0xFF20364E))),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF00D4AA).withAlpha(36),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                '$count selected',
                style: const TextStyle(
                  color: Color(0xFF75F7D7),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'Selected matches are ready to save.',
                style: TextStyle(
                  color: Colors.white.withAlpha(220),
                  fontSize: 13,
                ),
              ),
            ),
            TextButton(onPressed: onClear, child: const Text('Clear')),
            FilledButton.icon(
              onPressed: onOpenPicked,
              icon: const Icon(Icons.arrow_forward),
              label: const Text('Picked'),
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
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: highlight ? const Color(0xFF10253E) : const Color(0xFF0D1B2D),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: highlight ? const Color(0xFF00D4AA) : const Color(0xFF20364E),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                price,
                style: const TextStyle(
                  color: Color(0xFF75F7D7),
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: const TextStyle(color: Color(0xFFB8D5FF), fontSize: 13),
          ),
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
                      style: const TextStyle(color: Colors.white, fontSize: 13),
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

Widget _planNotice({required String title, required String body}) {
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: const Color(0xFF0D1B2D),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFF20364E)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          body,
          style: const TextStyle(
            color: Color(0xFFB8D5FF),
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

class _StickyHeader extends StatelessWidget {
  const _StickyHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'AI Football Prediction',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  height: 1.0,
                  letterSpacing: 0.2,
                ),
              ),
            ],
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('Policy'),
        backgroundColor: const Color(0xFF0A1220),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Privacy and App Policy',
            style: TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'This app provides football prediction content only. It does not encourage, promote, or require users to place bets. Any betting decision is entirely the user\'s responsibility and should only be made where it is legal and appropriate to do so. The app is for informational and entertainment purposes.',
            style: TextStyle(
              color: Color(0xFFB8D5FF),
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 20),
          _policySection(
            title: 'Important notice',
            body:
                'The app does not guarantee winnings, outcomes, or financial profit. Predictions are based on available data and should be treated as opinions, not certainty.',
          ),
          const SizedBox(height: 12),
          _policySection(
            title: 'Age and responsibility',
            body:
                'Users should comply with local laws and age restrictions. If gambling is restricted in your location or if you are under the legal age, do not use the app for betting-related activity.',
          ),
          const SizedBox(height: 12),
          _policySection(
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
          const Text(
            'Web policy source:',
            style: TextStyle(
              color: Color(0xFF84D6FF),
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          SelectableText(
            _policyUrl,
            style: const TextStyle(color: Color(0xFF75F7D7), fontSize: 13),
          ),
        ],
      ),
    );
  }
}

Widget _policySection({required String title, required String body}) {
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: const Color(0xFF0D1B2D),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0xFF20364E)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          body,
          style: const TextStyle(
            color: Color(0xFFB8D5FF),
            fontSize: 14,
            height: 1.5,
          ),
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

    widgets.add(const SizedBox(height: 12));

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
                adFree || isPickUnlocked(_predictionUnlockKey(prediction)),
            onSelectionPressed: () => onToggleSelection(prediction),
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
  widgets.add(const SizedBox(height: 14));

  if (selectedItems.isEmpty) {
    widgets.add(
      const Padding(
        padding: EdgeInsets.fromLTRB(20, 4, 20, 0),
        child: Text(
          'No matches in this category.',
          style: TextStyle(
            color: Color(0xFF84D6FF),
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
          canSelect: adFree || isPickUnlocked(_predictionUnlockKey(prediction)),
          onSelectionPressed: () => onToggleSelection(prediction),
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
    final items = _TodayBucket.values.map((bucket) {
      final isSelected = bucket == selectedBucket;
      final count = counts[bucket] ?? 0;
      return Expanded(
        child: GestureDetector(
          onTap: () => onSelectBucket(bucket),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            margin: const EdgeInsets.only(right: 8),
            decoration: BoxDecoration(
              color: isSelected
                  ? const Color(0xFF00D4AA)
                  : const Color(0xFF0D1B2D),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFF00D4AA)
                    : const Color(0xFF20364E),
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _todayBucketLabel(bucket),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: isSelected ? const Color(0xFF07111F) : Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$count',
                  style: TextStyle(
                    color: isSelected
                        ? const Color(0xFF07111F)
                        : const Color(0xFF84D6FF),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }).toList();

    return Row(children: items);
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
    return Container(
      width: double.infinity,
      child: Material(
        color: const Color(0xFF0D1B2D),
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: canToggle ? onTap : null,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFF20364E)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF00D4AA).withAlpha(31),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$count',
                    style: const TextStyle(
                      color: Color(0xFF75F7D7),
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (canToggle)
                  Icon(
                    isExpanded ? Icons.expand_less : Icons.expand_more,
                    color: const Color(0xFF84D6FF),
                  )
                else
                  const Icon(Icons.push_pin, color: Color(0xFF84D6FF)),
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
  });

  final PredictionRecord prediction;
  final bool isLocked;
  final bool isUnlocking;
  final VoidCallback onUnlockPressed;
  final bool isSelected;
  final bool canSelect;
  final VoidCallback onSelectionPressed;

  @override
  Widget build(BuildContext context) {
    final primaryPick = _PickCardData.fromPick(
      'Primary pick',
      prediction.primaryPick,
      const Color(0xFF00D4AA),
      prediction,
    );

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        color: const Color(0xFF0D1B2D),
        border: Border.all(color: const Color(0xFF20364E)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 20,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _MatchHeader(
              homeTeamLogoUrl: prediction.homeTeamLogoUrl,
              homeTeamName: prediction.homeTeamName,
              awayTeamLogoUrl: prediction.awayTeamLogoUrl,
              awayTeamName: prediction.awayTeamName,
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
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _MetaChip(
                  icon: Icons.schedule,
                  label: _formatTimeOnly(
                    prediction.kickoffAt ?? prediction.releaseAt,
                  ),
                ),
                _MetaChip(
                  icon: _matchStatusIcon(prediction),
                  label: _matchStatusLabel(prediction),
                ),
                if (prediction.predictedWinner != null)
                  _MetaChip(
                    icon: Icons.flag,
                    label: prediction.predictedWinner!,
                  ),
              ],
            ),
            const SizedBox(height: 10),
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
            if (canSelect) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.tonalIcon(
                  onPressed: onSelectionPressed,
                  icon: Icon(
                    isSelected ? Icons.check_circle : Icons.add_circle_outline,
                  ),
                  label: Text(isSelected ? 'Selected' : 'Select'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

Widget _teamBadge({
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

  return Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.08),
          shape: BoxShape.circle,
        ),
        clipBehavior: Clip.antiAlias,
        child: (logoUrl != null && logoUrl.isNotEmpty)
            ? Image.network(
                logoUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Center(
                  child: Text(
                    initials.isEmpty ? (isHome ? 'H' : 'A') : initials,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              )
            : Center(
                child: Text(
                  initials.isEmpty ? (isHome ? 'H' : 'A') : initials,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
      ),
      const SizedBox(height: 8),
      SizedBox(
        width: 110,
        child: Text(
          displayName,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700, height: 1.1),
        ),
      ),
      if (scoreText != null) ...[
        const SizedBox(height: 4),
        Text(
          scoreText,
          style: const TextStyle(
            color: Color(0xFF84D6FF),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    ],
  );
}

class _MatchHeader extends StatelessWidget {
  const _MatchHeader({
    required this.homeTeamLogoUrl,
    required this.homeTeamName,
    required this.awayTeamLogoUrl,
    required this.awayTeamName,
    required this.homeScore,
    required this.awayScore,
    required this.confidenceLabel,
  });

  final String? homeTeamLogoUrl;
  final String? homeTeamName;
  final String? awayTeamLogoUrl;
  final String? awayTeamName;
  final String? homeScore;
  final String? awayScore;
  final String confidenceLabel;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _teamBadge(
                logoUrl: homeTeamLogoUrl,
                teamName: homeTeamName,
                isHome: true,
                scoreText: homeScore,
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
              child: Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const RadialGradient(
                    colors: [Color(0xFF183B5B), Color(0xFF0E1E33)],
                    radius: 0.95,
                  ),
                  border: Border.all(color: const Color(0xFF2D5A86)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x3300D4AA),
                      blurRadius: 14,
                      offset: Offset(0, 6),
                    ),
                  ],
                ),
                child: const Center(
                  child: Text(
                    'VS',
                    style: TextStyle(
                      color: Color(0xFFBDF4FF),
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.1,
                      shadows: [
                        Shadow(
                          color: Color(0x6600D4AA),
                          blurRadius: 8,
                          offset: Offset(0, 2),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: _teamBadge(
                logoUrl: awayTeamLogoUrl,
                teamName: awayTeamName,
                isHome: false,
                scoreText: awayScore,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerRight,
          child: _StatusChip(label: confidenceLabel),
        ),
      ],
    );
  }
}

class _PickCard extends StatelessWidget {
  const _PickCard({super.key, required this.data});

  final _PickCardData data;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: const Color(0xFF13253A),
        border: Border.all(color: data.accent.withAlpha(89)),
      ),
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
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: data.accent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  data.label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (data.confidence != null) ...[
                const SizedBox(width: 8),
                _ConfidencePill(value: data.confidence!),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Text(
            finalSelection(data),
            style: const TextStyle(
              color: Color(0xFFB9D3E9),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            data.reason ?? 'No reason provided.',
            style: TextStyle(
              color: Colors.white.withAlpha(189),
              fontSize: 15,
              height: 1.45,
            ),
          ),
        ],
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: const Color(0xFF13253A),
        border: Border.all(color: const Color(0xFF294765)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.lock_outline, color: Color(0xFF84D6FF), size: 18),
              SizedBox(width: 8),
              Text(
                'Pick locked',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'Watch an ad to open this pick for this session.',
            style: TextStyle(
              color: Color(0xFFB9D3E9),
              fontSize: 14,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: isUnlocking ? null : onUnlockPressed,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF00D4AA),
                foregroundColor: const Color(0xFF07111F),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
              child: isUnlocking
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          Color(0xFF07111F),
                        ),
                      ),
                    )
                  : const Text(
                      'Watch ad to unlock',
                      style: TextStyle(fontWeight: FontWeight.w800),
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

String finalSelection(_PickCardData data) {
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

class _MiniStatusChip extends StatelessWidget {
  const _MiniStatusChip({
    required this.label,
    required this.color,
    required this.icon,
  });

  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withAlpha(28),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(80)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

String _scoreLabel(PredictionRecord prediction) {
  final home = prediction.fulltimeHomeGoals ?? prediction.currentHomeGoals;
  final away = prediction.fulltimeAwayGoals ?? prediction.currentAwayGoals;
  if (home == null && away == null) {
    return 'Score pending';
  }

  return '${home ?? '-'}-${away ?? '-'}';
}

_PickVerdict _pickVerdict(PredictionRecord prediction) {
  final outcome = prediction.matchOutcome?.trim().toLowerCase();
  if (outcome == null || outcome.isEmpty) {
    return _PickVerdict.pending;
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
    final percent = (value * 100).clamp(0, 100).round();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF00D4AA).withAlpha(31),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$percent%',
        style: const TextStyle(
          color: Color(0xFF75F7D7),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3147),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          color: Color(0xFFB8D5FF),
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: const Color(0xFF10253E),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFF20364E)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: const Color(0xFF84D6FF)),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
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
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 24),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: const Color(0xFF0D1B2D),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFF20364E)),
      ),
      child: Column(
        children: [
          Icon(icon, size: 42, color: const Color(0xFF84D6FF)),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            message,
            style: TextStyle(
              color: Colors.white.withAlpha(184),
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

IconData _matchStatusIcon(PredictionRecord prediction) {
  final label = _matchStatusLabel(prediction).toLowerCase();
  if (label.contains('live') || label.contains('going')) {
    return Icons.play_circle;
  }
  return Icons.schedule;
}
