import 'dart:async';
import 'package:appwrite/appwrite.dart';

import 'app_auth_service.dart';
import 'appwrite_config.dart';

class PredictionComment {
  const PredictionComment({
    required this.id,
    required this.fixtureApiId,
    required this.userName,
    required this.message,
    required this.createdAt,
    required this.selection,
  });

  final String id;
  final String fixtureApiId;
  final String userName;
  final String message;
  final DateTime? createdAt;
  final String? selection;
}

class LeaderboardEntry {
  const LeaderboardEntry({
    required this.userId,
    required this.userName,
    required this.points,
    required this.coins,
    required this.streakDays,
  });

  final String userId;
  final String userName;
  final int points;
  final int coins;
  final int streakDays;
}

class PredictionChallenge {
  const PredictionChallenge({
    required this.id,
    required this.title,
    required this.description,
    required this.targetCount,
    required this.rewardPoints,
    required this.status,
  });

  final String id;
  final String title;
  final String description;
  final int targetCount;
  final int rewardPoints;
  final String status;
}

class PredictionSocialSnapshot {
  const PredictionSocialSnapshot({
    required this.comments,
    required this.selectionCounts,
  });

  final List<PredictionComment> comments;
  final Map<String, int> selectionCounts;
}

class SocialEngagementService {
  SocialEngagementService._();

  static final SocialEngagementService instance = SocialEngagementService._();

  final Client _client = AppAuthService.instance.client;
  TablesDB? _tables;
  Realtime? _realtime;

  bool get hasCurrentUser => AppAuthService.instance.currentUser != null;

  TablesDB get _db => _tables ??= TablesDB(_client);
  Realtime get _rt => _realtime ??= Realtime(_client);

  Future<void> initialize() async {
    _tables ??= TablesDB(_client);
    _realtime ??= Realtime(_client);
  }

  Future<void> ensureProfile() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final now = DateTime.now().toUtc().toIso8601String();
    await _db.upsertRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      rowId: user.id,
      data: {
        'user_name': user.name,
        'email': user.email,
        'points': 0,
        'coins': 0,
        'streak_days': '0',
        'is_admin': false,
        'last_checkin_at': null,
        'created_at': now,
        'updated_at': now,
      },
      permissions: [
        Permission.read(Role.user(user.id)),
        Permission.update(Role.user(user.id)),
        Permission.delete(Role.user(user.id)),
      ],
    );
  }

  Future<void> recordSelection({
    required String fixtureApiId,
    required String selection,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final rowId = '${fixtureApiId}_${user.id}';
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.createRow(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionSelectionsTableId,
      rowId: rowId,
      data: {
        'fixture_api_id': fixtureApiId,
        'user_id': user.id,
        'user_name': user.name,
        'selection': selection,
        'created_at': now,
        'updated_at': now,
      },
    ).catchError((_) async {
      await _db.updateRow(
        databaseId: appwriteDatabaseId,
        tableId: appwritePredictionSelectionsTableId,
        rowId: rowId,
        data: {
          'selection': selection,
          'updated_at': now,
        },
      );
    });
  }

  Future<Map<String, int>> fetchSelectionCounts(String fixtureApiId) async {
    final rows = await _db.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionSelectionsTableId,
      queries: [
        Query.equal('fixture_api_id', fixtureApiId),
        Query.limit(200),
      ],
      total: false,
    );

    final counts = <String, int>{};
    for (final row in rows.rows) {
      final selection = _asString(row.data['selection'])?.trim();
      if (selection == null || selection.isEmpty) {
        continue;
      }
      counts[selection] = (counts[selection] ?? 0) + 1;
    }
    return counts;
  }

  Future<List<PredictionComment>> fetchComments(String fixtureApiId) async {
    final rows = await _db.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionCommentsTableId,
      queries: [
        Query.equal('fixture_api_id', fixtureApiId),
        Query.orderDesc('created_at'),
        Query.limit(50),
      ],
      total: false,
    );

    return rows.rows.map((row) {
      return PredictionComment(
        id: row.$id,
        fixtureApiId: fixtureApiId,
        userName: _asString(row.data['user_name']) ?? 'User',
        message: _asString(row.data['message']) ?? '',
        createdAt: DateTime.tryParse(_asString(row.data['created_at']) ?? ''),
        selection: _asString(row.data['selection']),
      );
    }).toList();
  }

  Future<void> addComment({
    required String fixtureApiId,
    required String message,
    String? selection,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    await _db.createRow(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionCommentsTableId,
      rowId: ID.unique(),
      data: {
        'fixture_api_id': fixtureApiId,
        'user_id': user.id,
        'user_name': user.name,
        'message': message.trim(),
        'selection': selection,
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

  Future<List<LeaderboardEntry>> fetchLeaderboard() async {
    final rows = await _db.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      queries: [
        Query.orderDesc('points'),
        Query.orderDesc('coins'),
        Query.limit(100),
      ],
      total: false,
    );

    return rows.rows.map((row) {
      return LeaderboardEntry(
        userId: _asString(row.data['user_id']) ?? row.$id,
        userName: _asString(row.data['user_name']) ?? 'User',
        points: _asInt(row.data['points']),
        coins: _asInt(row.data['coins']),
        streakDays: _asInt(row.data['streak_days']),
      );
    }).toList();
  }

  Future<void> checkInToday() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    await ensureProfile();

    final existing = await _db.getRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      rowId: user.id,
    ).catchError((_) => null);
    final currentCoins = _asInt(existing?.data['coins']);
    final currentStreak = _asInt(existing?.data['streak_days']);
    final nextStreak = currentStreak <= 0 ? 1 : currentStreak + 1;
    final rewardCoins = switch (nextStreak) {
      1 => 10,
      2 => 20,
      7 => 0,
      _ => nextStreak * 10,
    };

    final today = DateTime.now().toUtc();
    final dateKey = '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}';
    final checkInId = '${user.id}_$dateKey';

    final alreadyCheckedIn = await _db.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwriteDailyCheckinsTableId,
      queries: [
        Query.equal('date_key', dateKey),
        Query.equal('user_id', user.id),
        Query.limit(1),
      ],
      total: false,
    );
    if (alreadyCheckedIn.rows.isNotEmpty) {
      return;
    }

    await _db.createRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteDailyCheckinsTableId,
      rowId: checkInId,
      data: {
        'user_id': user.id,
        'date_key': dateKey,
        'reward_coins': rewardCoins,
        'created_at': today.toIso8601String(),
        'updated_at': today.toIso8601String(),
      },
    ).catchError((_) async {
      // Already checked in.
    });

    await _db.updateRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      rowId: existing?.$id ?? user.id,
      data: {
        'coins': currentCoins + rewardCoins,
        'streak_days': '$nextStreak',
        'last_checkin_at': today.toIso8601String(),
        'updated_at': today.toIso8601String(),
      },
    ).catchError((_) async {});
  }

  Future<List<PredictionChallenge>> fetchChallenges() async {
    final rows = await _db.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionChallengesTableId,
      queries: [
        Query.orderDesc('created_at'),
        Query.limit(50),
      ],
      total: false,
    );

    return rows.rows.map((row) {
      return PredictionChallenge(
        id: row.$id,
        title: _asString(row.data['title']) ?? 'Challenge',
        description: _asString(row.data['description']) ?? '',
        targetCount: _asInt(row.data['target_count']),
        rewardPoints: _asInt(row.data['reward_points']),
        status: _asString(row.data['status']) ?? 'open',
      );
    }).toList();
  }

  Future<void> submitChallengeEntry({
    required String challengeId,
    required String entryText,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final now = DateTime.now().toUtc().toIso8601String();
    await _db.createRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteChallengeEntriesTableId,
      rowId: ID.unique(),
      data: {
        'challenge_id': challengeId,
        'user_id': user.id,
        'user_name': user.name,
        'entry_text': entryText.trim(),
        'created_at': now,
        'updated_at': now,
      },
    );
  }

  Stream<PredictionSocialSnapshot> watchPrediction(String fixtureApiId) async* {
    yield PredictionSocialSnapshot(
      comments: await fetchComments(fixtureApiId),
      selectionCounts: await fetchSelectionCounts(fixtureApiId),
    );

    final subscription = _rt.subscribe([
      'databases.$appwriteDatabaseId.tables.$appwritePredictionCommentsTableId.rows',
      'databases.$appwriteDatabaseId.tables.$appwritePredictionSelectionsTableId.rows',
    ]);

    try {
      await for (final _ in subscription.stream) {
        yield PredictionSocialSnapshot(
          comments: await fetchComments(fixtureApiId),
          selectionCounts: await fetchSelectionCounts(fixtureApiId),
        );
      }
    } finally {
      subscription.close();
    }
  }

  Stream<List<LeaderboardEntry>> watchLeaderboard() async* {
    yield await fetchLeaderboard();

    final subscription = _rt.subscribe([
      'databases.$appwriteDatabaseId.tables.$appwriteUserProfilesTableId.rows',
    ]);

    try {
      await for (final _ in subscription.stream) {
        yield await fetchLeaderboard();
      }
    } finally {
      subscription.close();
    }
  }

  Stream<List<PredictionChallenge>> watchChallenges() async* {
    yield await fetchChallenges();

    final subscription = _rt.subscribe([
      'databases.$appwriteDatabaseId.tables.$appwritePredictionChallengesTableId.rows',
    ]);

    try {
      await for (final _ in subscription.stream) {
        yield await fetchChallenges();
      }
    } finally {
      subscription.close();
    }
  }
}

String? _asString(dynamic value) => value is String ? value : value?.toString();

int _asInt(dynamic value) {
  if (value is int) {
    return value;
  }
  return int.tryParse(_asString(value) ?? '') ?? 0;
}
