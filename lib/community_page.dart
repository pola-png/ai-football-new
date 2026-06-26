import 'package:flutter/material.dart';

import 'admin_access_service.dart';
import 'admin_notification_page.dart';
import 'social_engagement_service.dart';

bool _isDarkContext(BuildContext context) => Theme.of(context).brightness == Brightness.dark;

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
  return _isDarkContext(context) ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2);
}

Color _primaryText(BuildContext context) {
  return _isDarkContext(context) ? Colors.white : const Color(0xFF0F1A2C);
}

Color _secondaryText(BuildContext context) {
  return _isDarkContext(context) ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85);
}

class CommunityPage extends StatelessWidget {
  const CommunityPage({super.key});

  Future<void> _checkIn(BuildContext context) async {
    await SocialEngagementService.instance.checkInToday();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Check-in saved.')),
    );
  }

  Future<void> _submitChallengeEntry(BuildContext context, PredictionChallenge challenge) async {
    final controller = TextEditingController();
    final entry = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text('Submit for ${challenge.title}'),
          content: TextField(
            controller: controller,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: 'Write your challenge prediction',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(controller.text),
              child: const Text('Send'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    if (entry == null || entry.trim().isEmpty) return;

    await SocialEngagementService.instance.submitChallengeEntry(
      challengeId: challenge.id,
      entryText: entry,
    );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Challenge entry submitted.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AdminAccessService.instance,
      builder: (context, _) {
        final isAdmin = AdminAccessService.instance.isAdmin;
        final hasSession = SocialEngagementService.instance.hasCurrentUser;

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
              padding: const EdgeInsets.all(20),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Community',
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
                  !hasSession
                      ? 'Sign in to join the live community features.'
                      : 'Welcome back.',
                  style: TextStyle(
                    color: _secondaryText(context),
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 14),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final columns = constraints.maxWidth >= 1024
                        ? 3
                        : constraints.maxWidth >= 640
                            ? 2
                            : 1;
                    const gap = 12.0;
                    final cardWidth =
                        (constraints.maxWidth - gap * (columns - 1)) / columns;

                    final tiles = <Widget>[
                      if (isAdmin)
                        SizedBox(
                          width: cardWidth,
                          child: _communityCard(
                            context,
                            title: 'Admin broadcast',
                            body: 'Send notifications directly to subscribers.',
                            actionLabel: 'Open editor',
                            onPressed: () {
                              Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => const AdminNotificationPage(),
                                ),
                              );
                            },
                            compact: true,
                          ),
                        ),
                      SizedBox(
                        width: cardWidth,
                        child: _communityCard(
                          context,
                          title: 'Daily check-in',
                          body: '10 coins, 20 coins, premium reward.',
                          actionLabel: 'Check in',
                          onPressed: hasSession ? () => _checkIn(context) : null,
                          compact: true,
                        ),
                      ),
                      SizedBox(
                        width: cardWidth,
                        child: _communityCard(
                          context,
                          title: 'Leaderboard',
                          body: 'Live rankings update in real time.',
                          actionLabel: null,
                          onPressed: null,
                          compact: true,
                          child: SizedBox(
                            height: 140,
                            child: StreamBuilder<List<LeaderboardEntry>>(
                              stream: SocialEngagementService.instance.watchLeaderboard(),
                              builder: (context, snapshot) {
                                final entries = snapshot.data ?? const <LeaderboardEntry>[];
                                final displayRows = entries.isEmpty
                                    ? const [
                                        ('John', 1250),
                                        ('Sarah', 1180),
                                        ('Mike', 1140),
                                      ]
                                    : entries
                                        .take(3)
                                        .map((entry) => (entry.userName, entry.points))
                                        .toList();

                                return ListView.separated(
                                  itemCount: displayRows.length,
                                  separatorBuilder: (_, __) =>
                                      Divider(color: _screenBorder(context)),
                                  itemBuilder: (context, index) {
                                    final item = displayRows[index];
                                    return ListTile(
                                      dense: true,
                                      visualDensity: VisualDensity.compact,
                                      contentPadding: EdgeInsets.zero,
                                      title: Text(
                                        item.$1,
                                        style: TextStyle(
                                          color: _primaryText(context),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 13,
                                        ),
                                      ),
                                      subtitle: Text(
                                        '${item.$2} pts',
                                        style: TextStyle(
                                          color: _secondaryText(context),
                                          fontSize: 11,
                                        ),
                                      ),
                                      leading: CircleAvatar(
                                        radius: 13,
                                        backgroundColor:
                                            const Color(0xFF00D4AA).withAlpha(25),
                                        child: Text(
                                          '${index + 1}',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w900,
                                            fontSize: 11,
                                          ),
                                        ),
                                      ),
                                    );
                                  },
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                      SizedBox(
                        width: cardWidth,
                        child: _communityCard(
                          context,
                          title: 'Challenges',
                          body: 'Submit picks and earn points.',
                          actionLabel: null,
                          onPressed: null,
                          compact: true,
                          child: SizedBox(
                            height: 140,
                            child: StreamBuilder<List<PredictionChallenge>>(
                              stream: SocialEngagementService.instance.watchChallenges(),
                              builder: (context, snapshot) {
                                final challenges = snapshot.data ?? const <PredictionChallenge>[];
                                if (challenges.isEmpty) {
                                  return Center(
                                    child: Text(
                                      'No challenges yet.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: _secondaryText(context),
                                        fontSize: 12,
                                      ),
                                    ),
                                  );
                                }

                                return ListView.separated(
                                  itemCount: challenges.length > 3 ? 3 : challenges.length,
                                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                                  itemBuilder: (context, index) {
                                    final challenge = challenges[index];
                                    return Container(
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: _screenSurface(context, elevated: true),
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(color: _screenBorder(context)),
                                      ),
                                      child: Row(
                                        children: [
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  challenge.title,
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    color: _primaryText(context),
                                                    fontWeight: FontWeight.w800,
                                                    fontSize: 13,
                                                  ),
                                                ),
                                                const SizedBox(height: 2),
                                                Text(
                                                  '${challenge.targetCount} matches - ${challenge.rewardPoints} pts',
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: TextStyle(
                                                    color: _secondaryText(context),
                                                    fontSize: 11,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                          TextButton(
                                            onPressed: () =>
                                                _submitChallengeEntry(context, challenge),
                                            child: const Text('Join'),
                                          ),
                                        ],
                                      ),
                                    );
                                  },
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                    ];

                    return Wrap(
                      spacing: gap,
                      runSpacing: gap,
                      children: tiles,
                    );
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _communityCard(
    BuildContext context, {
    required String title,
    required String body,
    required String? actionLabel,
    required VoidCallback? onPressed,
    Widget? child,
    bool compact = false,
  }) {
    return Container(
      padding: EdgeInsets.all(compact ? 12 : 16),
      decoration: BoxDecoration(
        color: _screenSurface(context),
        borderRadius: BorderRadius.circular(compact ? 16 : 20),
        border: Border.all(color: _screenBorder(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: _primaryText(context),
              fontSize: compact ? 15 : 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            body,
            style: TextStyle(
              color: _secondaryText(context),
              height: compact ? 1.25 : 1.45,
              fontSize: compact ? 12 : 13,
            ),
          ),
          if (child != null) ...[
            const SizedBox(height: 8),
            child,
          ],
          if (actionLabel != null) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: onPressed,
                child: Text(actionLabel),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
