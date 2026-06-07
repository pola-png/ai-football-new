import 'package:flutter/material.dart';
import 'appwrite_subscription_service.dart';
import 'prediction_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await AppwriteSubscriptionService().ensureSubscribed();
  } catch (_) {
    // Push subscription issues should not block the prediction feed.
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ai football betting prediction',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00C2A8),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF07111F),
      ),
      home: const PredictionFeedPage(),
    );
  }
}

class PredictionFeedPage extends StatefulWidget {
  const PredictionFeedPage({super.key});

  @override
  State<PredictionFeedPage> createState() => _PredictionFeedPageState();
}

class _PredictionFeedPageState extends State<PredictionFeedPage> {
  final PredictionRepository _repository = PredictionRepository();
  late Future<List<PredictionRecord>> _futurePredictions;

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Color(0xFF07111F),
              Color(0xFF0B1D35),
              Color(0xFF122B4A),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: SafeArea(
          child: FutureBuilder<List<PredictionRecord>>(
            future: _futurePredictions,
            builder: (context, snapshot) {
              final predictions = snapshot.data ?? const <PredictionRecord>[];

              return RefreshIndicator(
                onRefresh: _reload,
                color: const Color(0xFF00D4AA),
                backgroundColor: const Color(0xFF0D1B2D),
                child: CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _HeaderCard(
                              title: 'Ai football betting prediction',
                              count: predictions.length,
                            ),
                            const SizedBox(height: 18),
                            if (snapshot.connectionState ==
                                    ConnectionState.waiting &&
                                predictions.isEmpty)
                              const Center(
                                child: Padding(
                                  padding: EdgeInsets.only(top: 32),
                                  child: CircularProgressIndicator(),
                                ),
                              )
                            else if (snapshot.hasError)
                              _EmptyState(
                                icon: Icons.error_outline,
                                title: 'Unable to load predictions',
                                message:
                                    'Pull to refresh and try again.',
                                actionLabel: 'Retry',
                                onAction: _reload,
                              )
                            else if (predictions.isEmpty)
                              const _EmptyState(
                                icon: Icons.sports_soccer,
                                title: 'No published picks yet',
                                message:
                                    'When the backend publishes predictions, they will appear here as primary pick cards.',
                              )
                            else
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: _buildGroupedPredictionWidgets(
                                  predictions,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(child: SizedBox(height: 24)),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({
    required this.title,
    required this.count,
  });

  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          colors: [Color(0xFF10253E), Color(0xFF0E3A46)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: const Color(0xFF1B4260)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x4000D4AA),
            blurRadius: 24,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF00D4AA).withAlpha(31),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count live cards',
              style: const TextStyle(
                color: Color(0xFF75F7D7),
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.w800,
              height: 1.05,
            ),
          ),
        ],
      ),
    );
  }
}

class _PredictionDateSection {
  const _PredictionDateSection({
    required this.date,
    required this.label,
    required this.predictions,
  });

  final DateTime date;
  final String label;
  final List<PredictionRecord> predictions;
}

List<Widget> _buildGroupedPredictionWidgets(List<PredictionRecord> predictions) {
  final sections = _groupPredictionsByDate(predictions);
  final widgets = <Widget>[];

  for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    final section = sections[sectionIndex];

    if (sectionIndex > 0) {
      widgets.add(const SizedBox(height: 20));
    }

    widgets.add(
      _DateSectionHeader(
        label: section.label,
        count: section.predictions.length,
      ),
    );
    widgets.add(const SizedBox(height: 12));

    for (var i = 0; i < section.predictions.length; i++) {
      widgets.add(PredictionGroupCard(prediction: section.predictions[i]));
      if (i < section.predictions.length - 1) {
        widgets.add(const SizedBox(height: 16));
      }
    }
  }

  return widgets;
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
      predictions: items,
    );
  }).toList();
}

DateTime _predictionDateKey(PredictionRecord prediction) {
  final source = prediction.kickoffAt ??
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
  final leftKickoff = left.kickoffAt ?? left.publishedAt ?? left.releaseAt;
  final rightKickoff = right.kickoffAt ?? right.publishedAt ?? right.releaseAt;

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

class _DateSectionHeader extends StatelessWidget {
  const _DateSectionHeader({
    required this.label,
    required this.count,
  });

  final String label;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF0D1B2D),
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
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
        ],
      ),
    );
  }
}

class PredictionGroupCard extends StatelessWidget {
  const PredictionGroupCard({super.key, required this.prediction});

  final PredictionRecord prediction;

  @override
  Widget build(BuildContext context) {
    final primaryPick = _PickCardData.fromPick(
      'Primary pick',
      prediction.primaryPick,
      const Color(0xFF00D4AA),
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
              confidenceLabel: prediction.confidenceLabel ?? 'live',
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _MetaChip(
                  icon: Icons.schedule,
                  label: _formatDateTime(prediction.kickoffAt ?? prediction.releaseAt),
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
            _PickCard(data: primaryPick),
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
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            height: 1.1,
          ),
        ),
      ),
    ],
  );
}

class _MatchHeader extends StatelessWidget {
  const _MatchHeader({
    required this.homeTeamLogoUrl,
    required this.homeTeamName,
    required this.awayTeamLogoUrl,
    required this.awayTeamName,
    required this.confidenceLabel,
  });

  final String? homeTeamLogoUrl;
  final String? homeTeamName;
  final String? awayTeamLogoUrl;
  final String? awayTeamName;
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
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: const Color(0xFF10253E),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF20364E)),
                ),
                child: const Center(
                  child: Icon(
                    Icons.sports_soccer,
                    size: 18,
                    color: Color(0xFF84D6FF),
                  ),
                ),
              ),
            ),
            Expanded(
              child: _teamBadge(
                logoUrl: awayTeamLogoUrl,
                teamName: awayTeamName,
                isHome: false,
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
  const _PickCard({required this.data});

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

String finalSelection(_PickCardData data) {
  return data.selection ?? data.market ?? 'Selection';
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
            FilledButton(
              onPressed: onAction,
              child: Text(actionLabel!),
            ),
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
  });

  final String label;
  final String? market;
  final String? selection;
  final double? confidence;
  final String? reason;
  final Color accent;

  bool get hasContent =>
      market != null || selection != null || confidence != null || reason != null;

  factory _PickCardData.fromPick(
    String label,
    PredictionPick? pick,
    Color accent,
  ) {
    return _PickCardData(
      label: label,
      market: pick?.market,
      selection: pick?.selection,
      confidence: pick?.confidence,
      reason: pick?.reason,
      accent: accent,
    );
  }
}

String _formatDate(DateTime? value) {
  if (value == null) {
    return 'unknown time';
  }

  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '${value.year}-$month-$day $hour:$minute';
}

String _formatDateTime(DateTime? value) {
  if (value == null) {
    return 'unknown time';
  }

  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  final hour = value.hour.toString().padLeft(2, '0');
  final minute = value.minute.toString().padLeft(2, '0');
  return '${value.year}-$month-$day $hour:$minute';
}

String _matchStatusLabel(PredictionRecord prediction) {
  final statusShort = prediction.matchStatusShort?.toUpperCase();
  final statusLong = prediction.matchStatusLong?.trim();
  final kickoffAt = prediction.kickoffAt;
  final now = DateTime.now();

  const liveStatuses = {
    '1H',
    'HT',
    '2H',
    'ET',
    'BT',
    'LIVE',
    'INT',
    'PEN',
  };

  if (statusShort != null && liveStatuses.contains(statusShort)) {
    return 'Live';
  }

  if (kickoffAt != null && now.isAfter(kickoffAt)) {
    return 'Going...';
  }

  if (statusLong != null && statusLong.isNotEmpty) {
    return statusLong;
  }

  return statusShort ?? 'Scheduled';
}

IconData _matchStatusIcon(PredictionRecord prediction) {
  final label = _matchStatusLabel(prediction).toLowerCase();
  if (label.contains('live') || label.contains('going')) {
    return Icons.play_circle;
  }
  return Icons.schedule;
}
