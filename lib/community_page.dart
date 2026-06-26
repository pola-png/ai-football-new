import 'package:flutter/material.dart';

import 'admin_access_service.dart';
import 'admin_notification_page.dart';
import 'app_auth_service.dart';
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

class CommunityPage extends StatelessWidget {
  const CommunityPage({super.key});

  Future<void> _checkIn(BuildContext context) async {
    await SocialEngagementService.instance.checkInToday();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Check-in saved.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = AppAuthService.instance.currentUser;

    return AnimatedBuilder(
      animation: AdminAccessService.instance,
      builder: (context, _) {
        final isAdmin = AdminAccessService.instance.isAdmin;

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
                if (user != null)
                  IconButton(
                    tooltip: 'Sign out',
                    onPressed: () => AppAuthService.instance.signOut(),
                    icon: const Icon(Icons.logout),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              user == null
                  ? 'Sign in to join the live community features.'
                  : 'Welcome back, ${user.name}.',
              style: TextStyle(
                color: _secondaryText(context),
                fontSize: 14,
              ),
            ),
            if (isAdmin) ...[
              const SizedBox(height: 18),
              _communityCard(
                context,
                title: 'Admin broadcast',
                body: 'Send a live notification to every subscribed user and keep the feed moving in real time.',
                actionLabel: 'Open notification editor',
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const AdminNotificationPage(),
                    ),
                  );
                },
              ),
            ],
            const SizedBox(height: 18),
            _communityCard(
              context,
              title: 'Daily check-in rewards',
              body: 'Day 1 = 10 coins\nDay 2 = 20 coins\nDay 7 = Premium prediction',
              actionLabel: 'Check in today',
              onPressed: user == null ? null : () => _checkIn(context),
            ),
            const SizedBox(height: 14),
            _communityCard(
              context,
              title: 'Leaderboard',
              body: 'Live rankings update as users earn points for correct predictions.',
              actionLabel: null,
              onPressed: null,
              child: SizedBox(
                height: 240,
                child: StreamBuilder<List<LeaderboardEntry>>(
                  stream: SocialEngagementService.instance.watchLeaderboard(),
                  builder: (context, snapshot) {
                    final entries = snapshot.data ?? const <LeaderboardEntry>[];
                    if (entries.isEmpty) {
                      final sample = const [
                        ('John', 1250),
                        ('Sarah', 1180),
                        ('Mike', 1140),
                      ];
                      return ListView.separated(
                        itemCount: sample.length,
                        separatorBuilder: (_, __) => Divider(color: _screenBorder(context)),
                        itemBuilder: (context, index) {
                          final item = sample[index];
                          return ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              item.$1,
                              style: TextStyle(color: _primaryText(context), fontWeight: FontWeight.w700),
                            ),
                            subtitle: Text(
                              '${item.$2} pts',
                              style: TextStyle(color: _secondaryText(context), fontSize: 12),
                            ),
                            leading: CircleAvatar(
                              backgroundColor: const Color(0xFF00D4AA).withAlpha(25),
                              child: Text(
                                '${index + 1}',
                                style: const TextStyle(fontWeight: FontWeight.w900),
                              ),
                            ),
                          );
                        },
                      );
                    }

                    return ListView.separated(
                      itemCount: entries.length,
                      separatorBuilder: (_, __) => Divider(color: _screenBorder(context)),
                      itemBuilder: (context, index) {
                        final entry = entries[index];
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            entry.userName,
                            style: TextStyle(color: _primaryText(context), fontWeight: FontWeight.w700),
                          ),
                          subtitle: Text(
                            '${entry.points} pts  •  ${entry.coins} coins  •  ${entry.streakDays} day streak',
                            style: TextStyle(color: _secondaryText(context), fontSize: 12),
                          ),
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xFF00D4AA).withAlpha(25),
                            child: Text(
                              '${index + 1}',
                              style: const TextStyle(fontWeight: FontWeight.w900),
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
            const SizedBox(height: 14),
            _communityCard(
              context,
              title: 'Prediction challenges',
              body: 'Users can submit challenge picks like "predict 5 matches today" and earn points if they are correct.',
              actionLabel: null,
              onPressed: null,
              child: SizedBox(
                height: 220,
                child: StreamBuilder<List<PredictionChallenge>>(
                  stream: SocialEngagementService.instance.watchChallenges(),
                  builder: (context, snapshot) {
                    final challenges = snapshot.data ?? const <PredictionChallenge>[];
                    if (challenges.isEmpty) {
                      return Center(
                        child: Text(
                          'Challenge templates will appear here as soon as the admin creates them.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: _secondaryText(context)),
                        ),
                      );
                    }

                    return ListView.separated(
                      itemCount: challenges.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, index) {
                        final challenge = challenges[index];
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
                              Text(
                                challenge.title,
                                style: TextStyle(
                                  color: _primaryText(context),
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                challenge.description,
                                style: TextStyle(
                                  color: _secondaryText(context),
                                  fontSize: 12,
                                  height: 1.35,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      '${challenge.targetCount} matches • ${challenge.rewardPoints} pts',
                                      style: TextStyle(
                                        color: _secondaryText(context),
                                        fontSize: 11,
                                      ),
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: () => _submitChallengeEntry(context, challenge),
                                    child: const Text('Submit'),
                                  ),
                                ],
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
          ],
            ),
          ),
        );
      },
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
    if (entry == null || entry.trim().isEmpty) {
      return;
    }

    await SocialEngagementService.instance.submitChallengeEntry(
      challengeId: challenge.id,
      entryText: entry,
    );
    if (!context.mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Challenge entry submitted.')),
    );
  }

  Widget _communityCard(
    BuildContext context, {
    required String title,
    required String body,
    required String? actionLabel,
    required VoidCallback? onPressed,
    Widget? child,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _screenSurface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _screenBorder(context)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: _primaryText(context),
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            style: TextStyle(color: _secondaryText(context), height: 1.45),
          ),
          if (child != null) ...[
            const SizedBox(height: 12),
            child,
          ],
          if (actionLabel != null) ...[
            const SizedBox(height: 12),
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
