import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';

import 'app_auth_service.dart';
import 'admin_access_service.dart';
import 'firebase_config.dart';
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
    required this.isAdmin,
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
  final bool isAdmin;
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

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  bool get hasCurrentUser => AppAuthService.instance.currentUser != null;

  Future<void> initialize() async {
    // Firestore is self-initializing in Flutter.
  }

  // Merges multiple streams into a single stream using standard Dart libraries
  Stream<void> _mergeStreams(List<Stream<dynamic>> streams) {
    final controller = StreamController<void>();
    final subscriptions = <StreamSubscription<dynamic>>[];

    void start() {
      for (final stream in streams) {
        final sub = stream.listen(
          (_) => controller.add(null),
          onError: controller.addError,
        );
        subscriptions.add(sub);
      }
    }

    controller.onListen = start;
    controller.onCancel = () async {
      for (final sub in subscriptions) {
        await sub.cancel();
      }
    };

    return controller.stream;
  }

  Future<void> ensureProfile() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final now = DateTime.now().toUtc().toIso8601String();
    final docRef = _firestore.collection(firebaseUserProfilesCollection).doc(user.id);
    DocumentSnapshot<Map<String, dynamic>>? docSnap;
    try {
      docSnap = await docRef.get();
    } catch (_) {
      docSnap = null;
    }

    final exists = docSnap != null && docSnap.exists;
    final data = <String, dynamic>{
      'user_name': user.name,
      'email': user.email,
      'is_admin': exists ? _asBool(docSnap.data()?['is_admin']) : false,
      'points': exists ? _asInt(docSnap.data()?['points']) : 0,
      'coins': exists ? _asInt(docSnap.data()?['coins']) : 0,
      'streak_days': exists ? (_asString(docSnap.data()?['streak_days']) ?? '0') : '0',
      'last_checkin_at': exists ? (docSnap.data()?['last_checkin_at']) : null,
      'created_at': exists ? (docSnap.data()?['created_at'] ?? now) : now,
      'updated_at': now,
    };

    await docRef.set(data, SetOptions(merge: true));
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
    final docRef = _firestore.collection(firebasePredictionSelectionsCollection).doc(rowId);

    if (selection.trim().isEmpty) {
      await docRef.delete();
      return;
    }

    await docRef.set({
      'fixture_api_id': fixtureApiId,
      'user_id': user.id,
      'user_name': user.name,
      'selection': selection.trim(),
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Future<void> clearSelectedPicks() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final snapshot = await _firestore
        .collection(firebasePredictionSelectionsCollection)
        .where('user_id', isEqualTo: user.id)
        .get();

    final batch = _firestore.batch();
    for (final doc in snapshot.docs) {
      batch.delete(doc.reference);
    }
    await batch.commit();
  }

  Future<Map<String, int>> fetchSelectionCounts(String fixtureApiId) async {
    final snapshot = await _firestore
        .collection(firebasePredictionSelectionsCollection)
        .where('fixture_api_id', isEqualTo: fixtureApiId)
        .get();

    final counts = <String, int>{};
    for (final doc in snapshot.docs) {
      final sel = _asString(doc.data()['selection'])?.trim();
      if (sel != null && sel.isNotEmpty) {
        counts[sel] = (counts[sel] ?? 0) + 1;
      }
    }
    return counts;
  }

  Future<List<PredictionComment>> fetchComments(String fixtureApiId) async {
    final snapshot = await _firestore
        .collection(firebasePredictionCommentsCollection)
        .where('fixture_api_id', isEqualTo: fixtureApiId)
        .get();

    final comments = snapshot.docs.map((doc) {
      final data = doc.data();
      return PredictionComment(
        id: doc.id,
        fixtureApiId: _asString(data['fixture_api_id']) ?? fixtureApiId,
        userName: _asString(data['user_name']) ?? 'User',
        message: _asString(data['message']) ?? '',
        createdAt: _asDateTime(data['created_at']),
        selection: _asString(data['selection']),
      );
    }).toList();

    comments.sort((a, b) {
      final aTime = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bTime = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return bTime.compareTo(aTime);
    });

    return comments;
  }

  Future<void> addComment({
    required String fixtureApiId,
    required String message,
    String? selection,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null || message.trim().isEmpty) {
      return;
    }

    await _firestore.collection(firebasePredictionCommentsCollection).add({
      'fixture_api_id': fixtureApiId,
      'user_id': user.id,
      'user_name': user.name,
      'message': message.trim(),
      'selection': selection,
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Future<void> checkInToday() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    await ensureProfile();

    final profileRef = _firestore.collection(firebaseUserProfilesCollection).doc(user.id);
    DocumentSnapshot<Map<String, dynamic>>? profileSnap;
    try {
      profileSnap = await profileRef.get();
    } catch (_) {
      profileSnap = null;
    }
    
    int currentCoins = 0;
    int currentStreak = 0;
    
    if (profileSnap != null && profileSnap.exists) {
      final profileData = profileSnap.data();
      currentCoins = _asInt(profileData?['coins']);
      currentStreak = _asInt(profileData?['streak_days']);
    }

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

    final checkinRef = _firestore.collection(firebaseDailyCheckinsCollection).doc(checkInId);
    DocumentSnapshot<Map<String, dynamic>>? checkinSnap;
    try {
      checkinSnap = await checkinRef.get();
    } catch (_) {
      checkinSnap = null;
    }
    if (checkinSnap != null && checkinSnap.exists) {
      return;
    }

    final nowStr = today.toIso8601String();
    try {
      await checkinRef.set({
        'user_id': user.id,
        'date_key': dateKey,
        'reward_coins': rewardCoins,
        'created_at': nowStr,
        'updated_at': nowStr,
      });
    } catch (_) {
      // Already checked in.
      return;
    }

    await profileRef.update({
      'coins': currentCoins + rewardCoins,
      'streak_days': '$nextStreak',
      'last_checkin_at': nowStr,
      'updated_at': nowStr,
    });
  }

  Future<List<LeaderboardEntry>> fetchLeaderboard() async {
    final snapshot = await _firestore
        .collection(firebaseUserProfilesCollection)
        .orderBy('points', descending: true)
        .limit(100)
        .get();

    return snapshot.docs.map((doc) {
      final data = doc.data();
      return LeaderboardEntry(
        userId: doc.id,
        userName: _asString(data['user_name']) ?? 'User',
        points: _asInt(data['points']),
        coins: _asInt(data['coins']),
        streakDays: _asInt(data['streak_days']),
      );
    }).toList();
  }

  Future<List<PredictionChallenge>> fetchChallenges() async {
    final snapshot = await _firestore
        .collection(firebasePredictionChallengesCollection)
        .where('status', isEqualTo: 'open')
        .get();

    return snapshot.docs.map((doc) {
      final data = doc.data();
      return PredictionChallenge(
        id: doc.id,
        title: _asString(data['title']) ?? '',
        description: _asString(data['description']) ?? '',
        targetCount: _asInt(data['target_count']),
        rewardPoints: _asInt(data['reward_points']),
        status: _asString(data['status']) ?? 'open',
      );
    }).toList();
  }

  Future<void> submitChallengeEntry({
    required String challengeId,
    required String entryText,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null || entryText.trim().isEmpty) {
      return;
    }

    await _firestore.collection(firebaseChallengeEntriesCollection).add({
      'challenge_id': challengeId,
      'user_id': user.id,
      'user_name': user.name,
      'entry_text': entryText.trim(),
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Future<List<Map<String, dynamic>>> fetchChallengeEntries(String challengeId) async {
    final snapshot = await _firestore
        .collection(firebaseChallengeEntriesCollection)
        .where('challenge_id', isEqualTo: challengeId)
        .get();

    return snapshot.docs.map((doc) {
      return {
        ...doc.data(),
        r'$id': doc.id,
      };
    }).toList();
  }

  Future<List<ChatMessageRecord>> fetchChatMessages({String roomId = firebaseChatRoomId}) async {
    final snapshot = await _firestore
        .collection(firebaseChatMessagesCollection)
        .where('room_id', isEqualTo: roomId)
        .get();

    final messages = snapshot.docs.map((doc) {
      final data = doc.data();
      return ChatMessageRecord(
        id: doc.id,
        roomId: _asString(data['room_id']) ?? roomId,
        userId: _asString(data['user_id']) ?? '',
        userName: _asString(data['user_name']) ?? 'User',
        isAdmin: _asBool(data['is_admin']),
        message: _asString(data['message']) ?? '',
        createdAt: _asDateTime(data['created_at']),
        parentMessageId: _asString(data['parent_message_id']),
        selectionFixtureApiId: _asString(data['selection_fixture_api_id']),
        selectionText: _asString(data['selection_text']),
      );
    }).toList();

    messages.sort((a, b) {
      final aTime = a.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bTime = b.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return aTime.compareTo(bTime);
    });

    return messages;
  }

  Future<Map<String, int>> fetchChatLikeCounts({String roomId = firebaseChatRoomId}) async {
    final snapshot = await _firestore
        .collection(firebaseChatMessageLikesCollection)
        .where('room_id', isEqualTo: roomId)
        .get();

    final counts = <String, int>{};
    for (final doc in snapshot.docs) {
      final msgId = _asString(doc.data()['message_id'])?.trim();
      if (msgId != null && msgId.isNotEmpty) {
        counts[msgId] = (counts[msgId] ?? 0) + 1;
      }
    }
    return counts;
  }

  Future<Set<String>> fetchMyLikedChatMessageIds({String roomId = firebaseChatRoomId}) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return const <String>{};
    }

    final snapshot = await _firestore
        .collection(firebaseChatMessageLikesCollection)
        .where('room_id', isEqualTo: roomId)
        .where('user_id', isEqualTo: user.id)
        .get();

    final likedIds = <String>{};
    for (final doc in snapshot.docs) {
      final msgId = _asString(doc.data()['message_id'])?.trim();
      if (msgId != null && msgId.isNotEmpty) {
        likedIds.add(msgId);
      }
    }
    return likedIds;
  }

  Future<void> sendChatMessage({
    String roomId = firebaseChatRoomId,
    required String message,
    String? parentMessageId,
    String? selectionFixtureApiId,
    String? selectionText,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null || message.trim().isEmpty) {
      return;
    }

    await _firestore.collection(firebaseChatMessagesCollection).add({
      'room_id': roomId,
      'user_id': user.id,
      'user_name': user.name,
      'is_admin': AdminAccessService.instance.isActuallyAdmin,
      'message': message.trim(),
      'parent_message_id': parentMessageId,
      'selection_fixture_api_id': selectionFixtureApiId,
      'selection_text': selectionText,
      'created_at': DateTime.now().toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    });
  }

  Future<void> toggleChatLike({
    String roomId = firebaseChatRoomId,
    required String messageId,
  }) async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return;
    }

    final docId = '${messageId}_${user.id}';
    final docRef = _firestore.collection(firebaseChatMessageLikesCollection).doc(docId);
    DocumentSnapshot<Map<String, dynamic>>? doc;
    try {
      doc = await docRef.get();
    } catch (_) {
      doc = null;
    }

    if (doc != null && doc.exists) {
      await docRef.delete();
    } else {
      await docRef.set({
        'room_id': roomId,
        'message_id': messageId,
        'user_id': user.id,
        'created_at': DateTime.now().toUtc().toIso8601String(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      });
    }
  }

  Stream<PredictionSocialSnapshot> watchPrediction(String fixtureApiId) async* {
    yield PredictionSocialSnapshot(
      comments: await fetchComments(fixtureApiId),
      selectionCounts: await fetchSelectionCounts(fixtureApiId),
    );

    final commentsStream = _firestore
        .collection(firebasePredictionCommentsCollection)
        .where('fixture_api_id', isEqualTo: fixtureApiId)
        .snapshots();

    final selectionsStream = _firestore
        .collection(firebasePredictionSelectionsCollection)
        .where('fixture_api_id', isEqualTo: fixtureApiId)
        .snapshots();

    await for (final _ in _mergeStreams([commentsStream, selectionsStream])) {
      yield PredictionSocialSnapshot(
        comments: await fetchComments(fixtureApiId),
        selectionCounts: await fetchSelectionCounts(fixtureApiId),
      );
    }
  }

  Stream<List<ChatMessageRecord>> watchChatMessages({String roomId = firebaseChatRoomId}) async* {
    yield await fetchChatMessages(roomId: roomId);

    final messagesStream = _firestore
        .collection(firebaseChatMessagesCollection)
        .where('room_id', isEqualTo: roomId)
        .snapshots();

    final likesStream = _firestore
        .collection(firebaseChatMessageLikesCollection)
        .where('room_id', isEqualTo: roomId)
        .snapshots();

    await for (final _ in _mergeStreams([messagesStream, likesStream])) {
      yield await fetchChatMessages(roomId: roomId);
    }
  }

  Future<List<PredictionRecord>> fetchPickedPredictions() async {
    final groups = await fetchPickedMatchesByDate();
    return groups.expand((group) => group.picks.map((pick) => pick.prediction)).toList();
  }

  Future<List<PickedMatchGroup>> fetchPickedMatchesByDate() async {
    final user = AppAuthService.instance.currentUser;
    if (user == null) {
      return const <PickedMatchGroup>[];
    }

    final selectionSnapshot = await _firestore
        .collection(firebasePredictionSelectionsCollection)
        .where('user_id', isEqualTo: user.id)
        .get();

    if (selectionSnapshot.docs.isEmpty) {
      return const <PickedMatchGroup>[];
    }

    final selections = selectionSnapshot.docs;
    final fixtureIds = selections.map((doc) => _asString(doc.data()['fixture_api_id']) ?? '').where((id) => id.isNotEmpty).toSet().toList();

    if (fixtureIds.isEmpty) {
      return const <PickedMatchGroup>[];
    }

    final predictionsSnapshot = await _firestore
        .collection(firebasePredictionsCollection)
        .where('fixture_api_id', whereIn: fixtureIds)
        .get();

    final predictionsMap = {
      for (final doc in predictionsSnapshot.docs)
        _asString(doc.data()['fixture_api_id']) ?? '': PredictionRecord.fromMap({
          ...doc.data(),
          r'$id': doc.id,
        })
    };

    final records = <PickedMatchRecord>[];
    for (final doc in selections) {
      final data = doc.data();
      final fixtureId = _asString(data['fixture_api_id']) ?? '';
      final prediction = predictionsMap[fixtureId];
      if (prediction == null) {
        continue;
      }
      records.add(PickedMatchRecord(
        selectionRowId: doc.id,
        selectedAt: _asDateTime(data['created_at']),
        selection: _asString(data['selection']) ?? '',
        prediction: prediction,
      ));
    }

    // Grouping logic in memory
    final groups = <DateTime, _PickedMatchGroupBuilder>{};
    for (final pick in records) {
      final dt = pick.prediction.kickoffAt ?? pick.prediction.publishedAt ?? pick.prediction.releaseAt;
      if (dt == null) continue;
      final local = dt.toLocal();
      final dateKey = DateTime(local.year, local.month, local.day);
      final builder = groups.putIfAbsent(dateKey, () => _PickedMatchGroupBuilder(date: dateKey));
      builder.picks.add(pick);
    }

    final sortedKeys = groups.keys.toList()..sort((a, b) => b.compareTo(a));
    return sortedKeys.map((key) {
      final builder = groups[key]!;
      builder.picks.sort((a, b) => (a.selectedAt ?? DateTime.now()).compareTo(b.selectedAt ?? DateTime.now()));
      final dateStr = '${key.day.toString().padLeft(2, '0')}/${key.month.toString().padLeft(2, '0')}/${key.year}';
      return PickedMatchGroup(
        date: key,
        label: dateStr,
        picks: builder.picks,
      );
    }).toList();
  }

  Stream<List<LeaderboardEntry>> watchLeaderboard() async* {
    yield await fetchLeaderboard();

    final subscription = _firestore.collection(firebaseUserProfilesCollection).snapshots();

    await for (final _ in subscription) {
      yield await fetchLeaderboard();
    }
  }

  Stream<List<PredictionChallenge>> watchChallenges() async* {
    yield await fetchChallenges();

    final subscription = _firestore.collection(firebasePredictionChallengesCollection).snapshots();

    await for (final _ in subscription) {
      yield await fetchChallenges();
    }
  }
}

class _PickedMatchGroupBuilder {
  _PickedMatchGroupBuilder({required this.date});

  final DateTime date;
  final List<PickedMatchRecord> picks = <PickedMatchRecord>[];
}

String? _asString(dynamic value) => value is String ? value : value?.toString();

bool _asBool(dynamic value) {
  if (value is bool) {
    return value;
  }
  if (value is num) {
    return value != 0;
  }
  final text = _asString(value)?.toLowerCase().trim();
  return text == 'true' || text == '1' || text == 'yes';
}

int _asInt(dynamic value) {
  if (value is int) {
    return value;
  }
  return int.tryParse(_asString(value) ?? '') ?? 0;
}

DateTime? _asDateTime(Object? value) {
  if (value == null) return null;
  if (value is Timestamp) {
    return value.toDate();
  }
  final text = _asString(value);
  if (text == null || text.isEmpty) {
    return null;
  }
  return DateTime.tryParse(text);
}
