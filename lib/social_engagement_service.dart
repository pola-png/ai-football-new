import 'dart:async';
import 'package:appwrite/appwrite.dart';

import 'app_auth_service.dart';
import 'appwrite_config.dart';
import 'prediction_repository.dart';

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

class ChatMessageRecord {
  const ChatMessageRecord({
    required this.id,
    required this.roomId,
    required this.userId,
    required this.userName,
    required this.message,
    required this.createdAt,
    required this.parentMessageId,
    required this.selectionFixtureApiId,
    required this.selectionText,
  });

  final String id;
  final String roomId;
  final String userId;
  final String userName;
  final String message;
  final DateTime? createdAt;
  final String? parentMessageId;
  final String? selectionFixtureApiId;
  final String? selectionText;
}

class PickedMatchRecord {
  const PickedMatchRecord({
    required this.selectionRowId,
    required this.selectedAt,
    required this.selection,
    required this.prediction,
  });

  final String selectionRowId;
  final DateTime? selectedAt;
  final String selection;
  final PredictionRecord prediction;
}

class PickedMatchGroup {
  const PickedMatchGroup({
    required this.date,
    required this.label,
    required this.picks,
  });

  final DateTime date;
  final String label;
  final List<PickedMatchRecord> picks;
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
    final existing = await _db.getRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      rowId: user.id,
    ).catchError((_) => null);

    final data = <String, dynamic>{
      'user_name': user.name,
      'email': user.email,
      'points': _asInt(existing?.data['points']),
      'coins': _asInt(existing?.data['coins']),
      'streak_days': _asString(existing?.data['streak_days']) ?? '0',
      'last_checkin_at': existing?.data['last_checkin_at'],
      'created_at': existing?.data['created_at'] ?? now,
      'updated_at': now,
    };

    if (existing == null) {
      await _db.createRow(
        databaseId: appwriteDatabaseId,
        tableId: appwriteUserProfilesTableId,
        rowId: user.id,
        data: data,
        permissions: [
          Permission.read(Role.user(user.id)),
          Permission.update(Role.user(user.id)),
          Permission.delete(Role.user(user.id)),
        ],
      );
      return;
    }

    await _db.updateRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteUserProfilesTableId,
      rowId: user.id,
      data: data,
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
    if (selection.trim().isEmpty) {
      await _db.deleteRow(
        databaseId: appwriteDatabaseId,
        tableId: appwritePredictionSelectionsTableId,
        rowId: rowId,
      ).catchError((_) {});
      return;
    }

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

  Future<void> clearSelectedPicks() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final rows = await _listAllRowsHelper(
      db: _db,
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionSelectionsTableId,
      queries: [
        Query.equal('user_id', user.id),
      ],
    );

    for (final row in rows.rows) {
      await _db.deleteRow(
        databaseId: appwriteDatabaseId,
        tableId: appwritePredictionSelectionsTableId,
        rowId: row.$id,
      ).catchError((_) {});
    }
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

  Future<List<PickedMatchGroup>> fetchPickedMatchesByDate() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return const [];
    }

    final selectedRows = await _listAllRowsHelper(
      db: _db,
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionSelectionsTableId,
      queries: [
        Query.equal('user_id', user.id),
        Query.orderDesc('created_at'),
      ],
    );

    final activeSelections = selectedRows.rows.where((row) {
      final selection = _asString(row.data['selection'])?.trim() ?? '';
      return selection.isNotEmpty;
    }).toList();

    if (activeSelections.isEmpty) {
      return const [];
    }

    final publishedPredictions = await PredictionRepository(client: _client)
        .fetchPublishedPredictions();
    final predictionByFixture = {
      for (final prediction in publishedPredictions) prediction.fixtureApiId: prediction,
    };

    final grouped = <String, _PickedMatchGroupBuilder>{};
    for (final row in activeSelections) {
      final fixtureApiId = _asString(row.data['fixture_api_id'])?.trim() ?? '';
      if (fixtureApiId.isEmpty) {
        continue;
      }

      final prediction = predictionByFixture[fixtureApiId];
      if (prediction == null) {
        continue;
      }

      final selectedAt = DateTime.tryParse(_asString(row.data['created_at']) ?? '');
      final groupDate = (prediction.kickoffAt ?? selectedAt ?? DateTime.now()).toLocal();
      final dateKey = _dateOnlyKey(groupDate);
      grouped.putIfAbsent(
        dateKey,
        () => _PickedMatchGroupBuilder(date: _dateOnly(groupDate)),
      ).picks.add(
        PickedMatchRecord(
          selectionRowId: row.$id,
          selectedAt: selectedAt,
          selection: _asString(row.data['selection'])?.trim() ?? '',
          prediction: prediction,
        ),
      );
    }

    final groups = grouped.values.toList()
      ..sort((left, right) => left.date.compareTo(right.date));

    return groups
        .map((group) => PickedMatchGroup(
              date: group.date,
              label: _formatPickedGroupLabel(group.date),
              picks: List<PickedMatchRecord>.from(group.picks)
                ..sort((left, right) {
                  final leftKickoff = left.prediction.kickoffAt ?? left.selectedAt;
                  final rightKickoff = right.prediction.kickoffAt ?? right.selectedAt;
                  if (leftKickoff == null && rightKickoff == null) {
                    return left.prediction.fixtureApiId.compareTo(right.prediction.fixtureApiId);
                  }
                  if (leftKickoff == null) return 1;
                  if (rightKickoff == null) return -1;
                  return leftKickoff.toUtc().compareTo(rightKickoff.toUtc());
                }),
            ))
        .toList();
  }

  Future<List<ChatMessageRecord>> fetchChatMessages({String roomId = appwriteChatRoomId}) async {
    final rows = await _listAllRowsHelper(
      db: _db,
      databaseId: appwriteDatabaseId,
      tableId: appwriteChatMessagesTableId,
      queries: [
        Query.equal('room_id', roomId),
        Query.orderAsc('created_at'),
      ],
    );

    return rows.rows.map((row) {
      return ChatMessageRecord(
        id: row.$id,
        roomId: _asString(row.data['room_id']) ?? roomId,
        userId: _asString(row.data['user_id']) ?? '',
        userName: _asString(row.data['user_name']) ?? 'User',
        message: _asString(row.data['message']) ?? '',
        createdAt: DateTime.tryParse(_asString(row.data['created_at']) ?? ''),
        parentMessageId: _asString(row.data['parent_message_id']),
        selectionFixtureApiId: _asString(row.data['selection_fixture_api_id']),
        selectionText: _asString(row.data['selection_text']),
      );
    }).toList();
  }

  Future<Map<String, int>> fetchChatLikeCounts({String roomId = appwriteChatRoomId}) async {
    final rows = await _listAllRowsHelper(
      db: _db,
      databaseId: appwriteDatabaseId,
      tableId: appwriteChatMessageLikesTableId,
      queries: [
        Query.equal('room_id', roomId),
      ],
    );

    final counts = <String, int>{};
    for (final row in rows.rows) {
      final messageId = _asString(row.data['message_id'])?.trim();
      if (messageId == null || messageId.isEmpty) {
        continue;
      }
      counts[messageId] = (counts[messageId] ?? 0) + 1;
    }
    return counts;
  }

  Future<Set<String>> fetchMyLikedChatMessageIds({String roomId = appwriteChatRoomId}) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return const <String>{};
    }

    final rows = await _listAllRowsHelper(
      db: _db,
      databaseId: appwriteDatabaseId,
      tableId: appwriteChatMessageLikesTableId,
      queries: [
        Query.equal('room_id', roomId),
        Query.equal('user_id', user.id),
      ],
    );

    final likedIds = <String>{};
    for (final row in rows.rows) {
      final messageId = _asString(row.data['message_id'])?.trim();
      if (messageId == null || messageId.isEmpty) {
        continue;
      }
      likedIds.add(messageId);
    }
    return likedIds;
  }

  Future<void> sendChatMessage({
    String roomId = appwriteChatRoomId,
    required String message,
    String? parentMessageId,
    String? selectionFixtureApiId,
    String? selectionText,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final text = message.trim();
    if (text.isEmpty) {
      return;
    }

    final now = DateTime.now().toUtc().toIso8601String();
    await _db.createRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteChatMessagesTableId,
      rowId: ID.unique(),
      data: {
        'room_id': roomId,
        'user_id': user.id,
        'user_name': user.name,
        'message': text,
        'parent_message_id': parentMessageId,
        'selection_fixture_api_id': selectionFixtureApiId,
        'selection_text': selectionText,
        'created_at': now,
        'updated_at': now,
      },
      permissions: [
        Permission.read(Role.users()),
        Permission.write(Role.user(user.id)),
      ],
    );
  }

  Future<void> toggleChatLike({
    String roomId = appwriteChatRoomId,
    required String messageId,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final likeRowId = _chatLikeRowId(
      roomId: roomId,
      messageId: messageId,
      userId: user.id,
    );
    final existing = await (() async {
      try {
        return await _db.getRow(
          databaseId: appwriteDatabaseId,
          tableId: appwriteChatMessageLikesTableId,
          rowId: likeRowId,
        );
      } catch (_) {
        return null;
      }
    })();

    if (existing == null) {
      final now = DateTime.now().toUtc().toIso8601String();
      await _db.createRow(
        databaseId: appwriteDatabaseId,
        tableId: appwriteChatMessageLikesTableId,
        rowId: likeRowId,
        data: {
          'room_id': roomId,
          'message_id': messageId,
          'user_id': user.id,
          'created_at': now,
          'updated_at': now,
        },
        permissions: [
          Permission.read(Role.users()),
          Permission.write(Role.user(user.id)),
        ],
      );
      return;
    }

    await _db.deleteRow(
      databaseId: appwriteDatabaseId,
      tableId: appwriteChatMessageLikesTableId,
      rowId: likeRowId,
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

  Stream<List<ChatMessageRecord>> watchChatMessages({String roomId = appwriteChatRoomId}) async* {
    yield await fetchChatMessages(roomId: roomId);

    final subscription = _rt.subscribe([
      'databases.$appwriteDatabaseId.tables.$appwriteChatMessagesTableId.rows',
      'databases.$appwriteDatabaseId.tables.$appwriteChatMessageLikesTableId.rows',
    ]);

    try {
      await for (final _ in subscription.stream) {
        yield await fetchChatMessages(roomId: roomId);
      }
    } finally {
      subscription.close();
    }
  }

  Future<List<PredictionRecord>> fetchPickedPredictions() async {
    final groups = await fetchPickedMatchesByDate();
    return groups.expand((group) => group.picks.map((pick) => pick.prediction)).toList();
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

class _PickedMatchGroupBuilder {
  _PickedMatchGroupBuilder({required this.date});

  final DateTime date;
  final List<PickedMatchRecord> picks = <PickedMatchRecord>[];
}

String? _asString(dynamic value) => value is String ? value : value?.toString();

int _asInt(dynamic value) {
  if (value is int) {
    return value;
  }
  return int.tryParse(_asString(value) ?? '') ?? 0;
}

Future<_ListRowsResult> _listAllRowsHelper({
  required TablesDB db,
  required String databaseId,
  required String tableId,
  required List<String> queries,
}) async {
  final rows = <dynamic>[];
  var offset = 0;
  while (true) {
    final response = await db.listRows(
      databaseId: databaseId,
      tableId: tableId,
      queries: [
        ...queries,
        Query.limit(100),
        Query.offset(offset),
      ],
      total: false,
    );
    rows.addAll(response.rows);
    if (response.rows.length < 100) {
      break;
    }
    offset += 100;
  }
  return _ListRowsResult(rows);
}

class _ListRowsResult {
  _ListRowsResult(this.rows);
  final List<dynamic> rows;
}

String _dateOnlyKey(DateTime date) {
  final local = date.toLocal();
  final year = local.year.toString().padLeft(4, '0');
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

DateTime _dateOnly(DateTime date) => DateTime(date.year, date.month, date.day);

String _formatPickedGroupLabel(DateTime date) {
  final now = DateTime.now();
  final local = date.toLocal();
  final diff = _dateOnly(local).difference(_dateOnly(now)).inDays;
  if (diff == 0) {
    return 'Today';
  }
  if (diff == 1) {
    return 'Tomorrow';
  }
  if (diff == -1) {
    return 'Yesterday';
  }
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')}';
}

String _chatLikeRowId({
  required String roomId,
  required String messageId,
  required String userId,
}) {
  final input = '$roomId|$messageId|$userId';
  var hash = 0xcbf29ce484222325;
  const prime = 0x100000001b3;

  for (final codeUnit in input.codeUnits) {
    hash ^= codeUnit;
    hash = (hash * prime) & 0xFFFFFFFFFFFFFFFF;
  }

  final hex = hash.toRadixString(16).padLeft(16, '0');
  return 'cl_${hex.substring(hex.length - 16)}';
}
