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
  const CommunityPage({
    super.key,
    required this.onOpenChat,
    required this.onOpenPickedMatches,
  });

  final VoidCallback onOpenChat;
  final VoidCallback onOpenPickedMatches;

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

  void _openPage(BuildContext context, Widget page) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => page),
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
                Text(
                  'Group',
                  style: TextStyle(
                    color: _primaryText(context),
                    fontSize: 28,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  hasSession
                      ? 'Open the community tools from one menu.'
                      : 'Sign in to use community tools.',
                  style: TextStyle(
                    color: _secondaryText(context),
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 16),
                _menuCard(
                  context,
                  icon: Icons.chat_bubble_outline,
                  title: 'Chat',
                  subtitle: 'Open the general chat room with replies and likes.',
                  onTap: onOpenChat,
                ),
                _menuCard(
                  context,
                  icon: Icons.fact_check_outlined,
                  title: 'Picked Matches',
                  subtitle: 'View saved picks grouped by date.',
                  onTap: onOpenPickedMatches,
                ),
                _menuCard(
                  context,
                  icon: Icons.calendar_month_outlined,
                  title: 'Daily Check-in',
                  subtitle: 'Earn coins for checking in each day.',
                  onTap: hasSession
                      ? () => _openPage(context, const DailyCheckInPage())
                      : null,
                ),
                _menuCard(
                  context,
                  icon: Icons.emoji_events_outlined,
                  title: 'Leaderboard',
                  subtitle: 'See the top community points table.',
                  onTap: () => _openPage(context, const LeaderboardPage()),
                ),
                _menuCard(
                  context,
                  icon: Icons.task_alt_outlined,
                  title: 'Challenges',
                  subtitle: 'Join live prediction challenges.',
                  onTap: () => _openPage(context, const ChallengesPage()),
                ),
                if (isAdmin)
                  _menuCard(
                    context,
                    icon: Icons.notifications_active_outlined,
                    title: 'Admin Broadcast',
                    subtitle: 'Send a push notification to users.',
                    onTap: () => _openPage(context, const AdminNotificationPage()),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _menuCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback? onTap,
  }) {
    final surface = _screenSurface(context);
    final border = _screenBorder(context);
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFF00D4AA)),
        title: Text(
          title,
          style: TextStyle(
            color: primaryText,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: TextStyle(color: secondaryText),
        ),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

class DailyCheckInPage extends StatelessWidget {
  const DailyCheckInPage({super.key});

  Future<void> _checkIn(BuildContext context) async {
    await SocialEngagementService.instance.checkInToday();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Check-in saved.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final surface = _screenSurface(context);
    final border = _screenBorder(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Daily Check-in')),
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
              'Daily rewards',
              style: TextStyle(color: primaryText, fontSize: 28, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            Text(
              'Tap once per day to keep your streak going and earn coins.',
              style: TextStyle(color: secondaryText, fontSize: 14, height: 1.45),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: border),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Rewards', style: TextStyle(fontWeight: FontWeight.w800)),
                  SizedBox(height: 10),
                  Text('Day 1 - 10 coins'),
                  SizedBox(height: 6),
                  Text('Day 2 - 20 coins'),
                  SizedBox(height: 6),
                  Text('Long streaks unlock bigger rewards'),
                ],
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _checkIn(context),
              icon: const Icon(Icons.check_circle_outline),
              label: const Text('Check in now'),
            ),
          ],
        ),
      ),
    );
  }
}

class LeaderboardPage extends StatelessWidget {
  const LeaderboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final surface = _screenSurface(context);
    final border = _screenBorder(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Leaderboard')),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: _screenGradient(context),
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: RefreshIndicator(
          onRefresh: () async {},
          child: StreamBuilder<List<LeaderboardEntry>>(
            stream: SocialEngagementService.instance.watchLeaderboard(),
            builder: (context, snapshot) {
              final entries = snapshot.data ?? const <LeaderboardEntry>[];
              final rows = entries.isEmpty
                  ? const <LeaderboardEntry>[]
                  : entries;

              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'Top players',
                    style: TextStyle(color: primaryText, fontSize: 28, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Live rankings update automatically.',
                    style: TextStyle(color: secondaryText, fontSize: 14),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    decoration: BoxDecoration(
                      color: surface,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: border),
                    ),
                    child: rows.isEmpty
                        ? Padding(
                            padding: const EdgeInsets.all(18),
                            child: Text(
                              'No leaderboard entries yet.',
                              style: TextStyle(color: secondaryText),
                            ),
                          )
                        : Column(
                            children: [
                              for (var index = 0; index < rows.length; index++)
                                ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: const Color(0xFF00D4AA).withAlpha(35),
                                    child: Text('${index + 1}'),
                                  ),
                                  title: Text(
                                    rows[index].userName,
                                    style: TextStyle(
                                      color: primaryText,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  subtitle: Text(
                                    '${rows[index].coins} coins | ${rows[index].streakDays} day streak',
                                    style: TextStyle(color: secondaryText),
                                  ),
                                  trailing: Text(
                                    '${rows[index].points} pts',
                                    style: TextStyle(
                                      color: primaryText,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class ChallengesPage extends StatelessWidget {
  const ChallengesPage({super.key});

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
    final primaryText = _primaryText(context);
    final secondaryText = _secondaryText(context);
    final surface = _screenSurface(context);
    final border = _screenBorder(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Challenges')),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: _screenGradient(context),
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: RefreshIndicator(
          onRefresh: () async {},
          child: StreamBuilder<List<PredictionChallenge>>(
            stream: SocialEngagementService.instance.watchChallenges(),
            builder: (context, snapshot) {
              final challenges = snapshot.data ?? const <PredictionChallenge>[];

              return ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(20),
                children: [
                  Text(
                    'Live challenges',
                    style: TextStyle(color: primaryText, fontSize: 28, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Pick one challenge and submit your entry.',
                    style: TextStyle(color: secondaryText, fontSize: 14),
                  ),
                  const SizedBox(height: 16),
                  if (challenges.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: surface,
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(color: border),
                      ),
                      child: Text(
                        'No challenges yet.',
                        style: TextStyle(color: secondaryText),
                      ),
                    )
                  else
                    for (final challenge in challenges)
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
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
                              challenge.title,
                              style: TextStyle(
                                color: primaryText,
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              challenge.description,
                              style: TextStyle(color: secondaryText, height: 1.4),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${challenge.targetCount} matches - ${challenge.rewardPoints} pts',
                              style: TextStyle(color: secondaryText, fontSize: 12),
                            ),
                            const SizedBox(height: 10),
                            Align(
                              alignment: Alignment.centerRight,
                              child: FilledButton(
                                onPressed: () => _submitChallengeEntry(context, challenge),
                                child: const Text('Join challenge'),
                              ),
                            ),
                          ],
                        ),
                      ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
