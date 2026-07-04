import 'dart:convert';

import 'package:appwrite/appwrite.dart';

import 'appwrite_config.dart';

class PredictionPick {
  const PredictionPick({
    required this.market,
    required this.selection,
    required this.confidence,
    required this.reason,
    this.odd,
  });

  final String? market;
  final String? selection;
  final double? confidence;
  final String? reason;
  final double? odd;

  factory PredictionPick.fromMap(Map<String, dynamic> data, String prefix, {double? odd}) {
    return PredictionPick(
      market: _asString(data['${prefix}market']),
      selection: _asString(data['${prefix}selection']),
      confidence: _asDouble(data['${prefix}confidence']),
      reason: _asString(data['${prefix}reason']),
      odd: odd,
    );
  }
}

class PredictionRecord {
  const PredictionRecord({
    this.recordId,
    required this.fixtureApiId,
    required this.modelName,
    required this.predictionText,
    required this.confidenceLabel,
    required this.homeTeamName,
    required this.awayTeamName,
    required this.homeTeamLogoUrl,
    required this.awayTeamLogoUrl,
    required this.kickoffAt,
    required this.matchStatusShort,
    required this.matchStatusLong,
    required this.primaryPick,
    required this.secondaryPick,
    required this.tertiaryPick,
    required this.releaseAt,
    required this.generatedAt,
    required this.publishedAt,
    required this.predictedWinner,
    required this.confidence,
    required this.market,
    required this.matchOutcome,
    required this.resultCheckedAt,
    required this.currentHomeGoals,
    required this.currentAwayGoals,
    required this.fulltimeHomeGoals,
    required this.fulltimeAwayGoals,
    this.adminPlanOverride,
  });

  final String? recordId;
  final String fixtureApiId;
  final String? modelName;
  final String predictionText;
  final String? confidenceLabel;
  final String? homeTeamName;
  final String? awayTeamName;
  final String? homeTeamLogoUrl;
  final String? awayTeamLogoUrl;
  final DateTime? kickoffAt;
  final String? matchStatusShort;
  final String? matchStatusLong;
  final PredictionPick? primaryPick;
  final PredictionPick? secondaryPick;
  final PredictionPick? tertiaryPick;
  final DateTime? releaseAt;
  final DateTime? generatedAt;
  final DateTime? publishedAt;
  final String? predictedWinner;
  final double? confidence;
  final String? market;
  final String? matchOutcome;
  final DateTime? resultCheckedAt;
  final String? currentHomeGoals;
  final String? currentAwayGoals;
  final String? fulltimeHomeGoals;
  final String? fulltimeAwayGoals;
  final String? adminPlanOverride;

  factory PredictionRecord.fromMap(Map<String, dynamic> data) {
    final predictionJson = _asString(data['prediction_json']);
    Map<String, dynamic>? parsedJson;
    if (predictionJson != null && predictionJson.isNotEmpty) {
      try {
        final decoded = jsonDecode(predictionJson);
        if (decoded is Map<String, dynamic>) {
          parsedJson = decoded;
        }
      } catch (_) {
        parsedJson = null;
      }
    }

    return PredictionRecord(
      recordId: _asString(data[r'$id']) ?? '',
      fixtureApiId: _asString(data['fixture_api_id']) ?? '',
      modelName: _asString(data['model_name']),
      predictionText: _resolvePredictionText(data, parsedJson),
      confidenceLabel: _asString(data['confidence_label']),
      homeTeamName: _asString(data['home_team_name']),
      awayTeamName: _asString(data['away_team_name']),
      homeTeamLogoUrl: _asString(data['home_team_logo_url']),
      awayTeamLogoUrl: _asString(data['away_team_logo_url']),
      kickoffAt: _asDateTime(data['kickoff_at']),
      matchStatusShort: _asString(data['match_status_short']),
      matchStatusLong: _asString(data['match_status_long']),
      primaryPick: _pickFromData(data, 'primary_', parsedJson?['primary_pick']),
      secondaryPick: _pickFromData(data, 'secondary_', parsedJson?['secondary_pick']),
      tertiaryPick: _pickFromData(data, 'tertiary_', parsedJson?['tertiary_pick']),
      releaseAt: _asDateTime(data['release_at']),
      generatedAt: _asDateTime(data['generated_at']),
      publishedAt: _asDateTime(data['published_at']),
      predictedWinner: _asString(data['predicted_winner']),
      confidence: _asDouble(data['confidence']),
      market: _asString(data['market']) ?? _asString(parsedJson?['market']),
      matchOutcome: _asString(data['match_outcome']),
      resultCheckedAt: _asDateTime(data['result_checked_at']),
      currentHomeGoals: _asString(data['current_home_goals']),
      currentAwayGoals: _asString(data['current_away_goals']),
      fulltimeHomeGoals: _asString(data['fulltime_home_goals']),
      fulltimeAwayGoals: _asString(data['fulltime_away_goals']),
      adminPlanOverride: _asString(data['admin_plan_override']),
    );
  }

  static PredictionPick? _pickFromData(
    Map<String, dynamic> data,
    String prefix, [
    dynamic jsonPick,
  ]) {
    final market = _asString(data['${prefix}market']) ?? (jsonPick is Map ? _asString(jsonPick['market']) : null);
    final selection = _asString(data['${prefix}selection']) ?? (jsonPick is Map ? _asString(jsonPick['selection']) : null);
    final confidence = _asDouble(data['${prefix}confidence']) ?? (jsonPick is Map ? _asDouble(jsonPick['confidence']) : null);
    final reason = _asString(data['${prefix}reason']) ?? (jsonPick is Map ? _asString(jsonPick['reason']) : null);
    final odd = jsonPick is Map ? _asDouble(jsonPick['odd']) : null;

    if (market == null && selection == null && confidence == null && reason == null) {
      return null;
    }

    return PredictionPick(
      market: market,
      selection: selection,
      confidence: confidence,
      reason: reason,
      odd: odd,
    );
  }
}

class PredictionRepository {
  PredictionRepository({Client? client}) : _client = client ?? Client();

  final Client _client;
  static const int _pageSize = 100;

  TablesDB get _tables => TablesDB(_client);

  void configure() {
    if (appwriteEndpoint.isNotEmpty && appwriteProjectId.isNotEmpty) {
      _client.setEndpoint(appwriteEndpoint).setProject(appwriteProjectId);
    }
  }

  Future<List<PredictionRecord>> fetchPublishedPredictions() async {
    configure();

    final rows = await _fetchAllRows([
      Query.equal('release_status', 'published'),
      Query.orderDesc('release_at'),
    ]);

    // For any prediction missing team names, fetch them from the fixtures table
    final needsEnrich = rows.where(
      (p) => (p.homeTeamName == null || p.homeTeamName!.isEmpty) ||
             (p.awayTeamName == null || p.awayTeamName!.isEmpty),
    ).toList();

    if (needsEnrich.isNotEmpty) {
      final fixtureIds = needsEnrich.map((p) => p.fixtureApiId).toSet().toList();
      final fixtureMap = await _fetchFixtureTeamNames(fixtureIds);

      final enriched = rows.map((p) {
        if ((p.homeTeamName == null || p.homeTeamName!.isEmpty) ||
            (p.awayTeamName == null || p.awayTeamName!.isEmpty)) {
          final f = fixtureMap[p.fixtureApiId];
          if (f != null) {
            return PredictionRecord(
              recordId: p.recordId,
              fixtureApiId: p.fixtureApiId,
              modelName: p.modelName,
              predictionText: p.predictionText,
              confidenceLabel: p.confidenceLabel,
              homeTeamName: p.homeTeamName?.isNotEmpty == true ? p.homeTeamName : f['home_team_name'],
              awayTeamName: p.awayTeamName?.isNotEmpty == true ? p.awayTeamName : f['away_team_name'],
              homeTeamLogoUrl: p.homeTeamLogoUrl?.isNotEmpty == true ? p.homeTeamLogoUrl : f['home_team_logo_url'],
              awayTeamLogoUrl: p.awayTeamLogoUrl?.isNotEmpty == true ? p.awayTeamLogoUrl : f['away_team_logo_url'],
              kickoffAt: p.kickoffAt,
              matchStatusShort: p.matchStatusShort,
              matchStatusLong: p.matchStatusLong,
              primaryPick: p.primaryPick,
              secondaryPick: p.secondaryPick,
              tertiaryPick: p.tertiaryPick,
              releaseAt: p.releaseAt,
              generatedAt: p.generatedAt,
              publishedAt: p.publishedAt,
              predictedWinner: p.predictedWinner,
              confidence: p.confidence,
              market: p.market,
              matchOutcome: p.matchOutcome,
              resultCheckedAt: p.resultCheckedAt,
              currentHomeGoals: p.currentHomeGoals,
              currentAwayGoals: p.currentAwayGoals,
              fulltimeHomeGoals: p.fulltimeHomeGoals,
              fulltimeAwayGoals: p.fulltimeAwayGoals,
              adminPlanOverride: p.adminPlanOverride,
            );
          }
        }
        return p;
      }).toList();

      final filtered = enriched.where(_hasRenderablePrimaryPick).toList();
      filtered.sort(_comparePredictionsForDisplay);
      return filtered;
    }

    final filtered = rows.where(_hasRenderablePrimaryPick).toList();
    filtered.sort(_comparePredictionsForDisplay);
    return filtered;
  }

  Future<Map<String, Map<String, String?>>> _fetchFixtureTeamNames(List<String> fixtureApiIds) async {
    final result = <String, Map<String, String?>>{};
    if (fixtureApiIds.isEmpty) return result;

    const batchSize = 25;
    for (var i = 0; i < fixtureApiIds.length; i += batchSize) {
      final batch = fixtureApiIds.sublist(i, (i + batchSize).clamp(0, fixtureApiIds.length));
      try {
        final response = await _tables.listRows(
          databaseId: appwriteDatabaseId,
          tableId: appwriteFixturesTableId,
          queries: [
            Query.equal('api_fixture_id', batch),
            Query.limit(batch.length),
          ],
          total: false,
        );
        for (final row in response.rows) {
          final data = _normalizeRow(row);
          final id = _asString(data['api_fixture_id']);
          if (id != null && id.isNotEmpty) {
            result[id] = {
              'home_team_name': _asString(data['home_team_name']),
              'away_team_name': _asString(data['away_team_name']),
              'home_team_logo_url': _asString(data['home_team_logo_url']),
              'away_team_logo_url': _asString(data['away_team_logo_url']),
            };
          }
        }
      } catch (_) {
        // silently skip — team names are cosmetic, don't crash the feed
      }
    }
    return result;
  }

  Future<void> updatePredictionPlanOverride(String recordId, String? planOverride, double? confidenceOverride) async {
    configure();
    final data = <String, dynamic>{
      if (planOverride != null) 'admin_plan_override': planOverride,
      if (planOverride == null) 'admin_plan_override': null,
      if (confidenceOverride != null) 'confidence': confidenceOverride,
      if (confidenceOverride != null) 'primary_confidence': confidenceOverride,
    };
    await _tables.updateRow(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionsTableId,
      rowId: recordId,
      data: data,
    );
  }

  Future<List<PredictionRecord>> _fetchAllRows(List<String> baseQueries) async {
    final records = <PredictionRecord>[];
    var offset = 0;

    while (true) {
      final response = await _tables.listRows(
        databaseId: appwriteDatabaseId,
        tableId: appwritePredictionsTableId,
        queries: [
          ...baseQueries,
          Query.limit(_pageSize),
          Query.offset(offset),
        ],
        total: false,
      );

      final rows = response.rows
          .map((row) => PredictionRecord.fromMap(_normalizeRow(row)))
          .toList();

      records.addAll(rows);
      if (rows.length < _pageSize) {
        break;
      }

      offset += _pageSize;
    }

    return records;
  }

  Future<List<PredictionRecord>> _fetchRows(List<String> queries) async {
    final response = await _tables.listRows(
      databaseId: appwriteDatabaseId,
      tableId: appwritePredictionsTableId,
      queries: queries,
      total: false,
    );

    return response.rows
        .map((row) => PredictionRecord.fromMap(_normalizeRow(row)))
        .toList();
  }

  Future<Map<String, dynamic>> getTodayStats() async {
    final predictions = await fetchPublishedPredictions();
    final now = DateTime.now().toLocal();
    final todayFinished = predictions.where((p) {
      final kickoffAt = p.kickoffAt;
      if (kickoffAt == null) return false;

      final kickoffLocal = kickoffAt.toLocal();
      final isSameDay = kickoffLocal.year == now.year &&
          kickoffLocal.month == now.month &&
          kickoffLocal.day == now.day;
      if (!isSameDay) return false;

      return _isFinishedPrediction(p, now) || (p.matchOutcome?.trim().isNotEmpty ?? false);
    }).toList();

    var correctCount = 0;
    for (final p in todayFinished) {
      final outcome = p.matchOutcome?.trim().toLowerCase();
      if (outcome == 'void') {
        correctCount++;
        continue;
      }

      if (outcome == null || outcome.isEmpty) {
        if (_isFinishedPrediction(p, now)) {
          correctCount++;
        }
        continue;
      }

      final rawSelection = (p.primaryPick?.selection ?? '').trim();
      final rawMarket = (p.primaryPick?.market ?? '').trim();
      final marketLower = rawMarket.toLowerCase();
      final selLower = rawSelection.toLowerCase();

      final homeTeam = _normalizeTextLocal(p.homeTeamName ?? '');
      final awayTeam = _normalizeTextLocal(p.awayTeamName ?? '');
      final homeGoals = _goalCountLocal(p.fulltimeHomeGoals ?? p.currentHomeGoals);
      final awayGoals = _goalCountLocal(p.fulltimeAwayGoals ?? p.currentAwayGoals);

      var isCorrect = false;
      var handled = false;

      // BTTS — check market first
      if (marketLower == 'btts' || marketLower.contains('both team')) {
        handled = true;
        if (homeGoals != null && awayGoals != null) {
          final yesPicked = selLower == 'yes';
          final actualYes = homeGoals > 0 && awayGoals > 0;
          isCorrect = yesPicked == actualYes;
        }
      }

      // Double Chance — check market first
      if (!handled && marketLower == 'double chance') {
        handled = true;
        if (homeGoals != null && awayGoals != null) {
          if (selLower == '1x') isCorrect = homeGoals >= awayGoals;
          else if (selLower == 'x2') isCorrect = awayGoals >= homeGoals;
          else if (selLower == '12') isCorrect = homeGoals != awayGoals;
        }
      }

      // Over/Under — check market first
      if (!handled && (marketLower == 'over/under' || marketLower.contains('over') || marketLower.contains('under'))) {
        final overUnder = _parseOverUnderSelectionLocal(_normalizeTextLocal(rawSelection));
        if (overUnder != null) {
          handled = true;
          if (homeGoals != null && awayGoals != null) {
            final totalGoals = homeGoals + awayGoals;
            isCorrect = overUnder.isOver
                ? totalGoals > overUnder.line
                : totalGoals < overUnder.line;
          }
        }
      }

      // Draw market
      if (!handled && marketLower == 'draw') {
        handled = true;
        if (selLower == 'yes') isCorrect = outcome == 'draw';
        else if (selLower == 'no') isCorrect = outcome != 'draw';
      }

      // Winner market
      if (!handled && marketLower == 'winner') {
        handled = true;
        if (selLower.contains('home')) isCorrect = outcome == 'home';
        else if (selLower.contains('away')) isCorrect = outcome == 'away';
        else if (selLower.contains('draw')) isCorrect = outcome == 'draw';
      }

      // Fallback: original text-matching logic
      if (!handled) {
        final selection = _normalizeSelectionLocal(p);

        if (selection.contains('btts')) {
          if (homeGoals != null && awayGoals != null) {
            final yesPicked = selection.contains('yes');
            final actualYes = homeGoals > 0 && awayGoals > 0;
            isCorrect = yesPicked == actualYes;
          }
        } else {
          final overUnder = _parseOverUnderSelectionLocal(selection);
          if (overUnder != null) {
            if (homeGoals != null && awayGoals != null) {
              final totalGoals = homeGoals + awayGoals;
              isCorrect = overUnder.isOver
                  ? totalGoals > overUnder.line
                  : totalGoals < overUnder.line;
            }
          } else if (selection.contains('home') || (selection.contains('1') && !selection.contains('1.')) || selection.contains(homeTeam)) {
            isCorrect = outcome == 'home';
          } else if (selection.contains('away') || (selection.contains('2') && !selection.contains('2.')) || selection.contains(awayTeam)) {
            isCorrect = outcome == 'away';
          } else if (selection.contains('draw') || selection == 'x') {
            isCorrect = outcome == 'draw';
          } else if (p.predictedWinner != null) {
            final predictedWinner = _normalizeTextLocal(p.predictedWinner!);
            if (predictedWinner.contains(homeTeam)) {
              isCorrect = outcome == 'home';
            } else if (predictedWinner.contains(awayTeam)) {
              isCorrect = outcome == 'away';
            } else if (predictedWinner.contains('draw')) {
              isCorrect = outcome == 'draw';
            }
          }
        }
      }

      if (isCorrect) {
        correctCount++;
      }
    }

    final overallAccuracy = todayFinished.isEmpty ? 0 : ((correctCount / todayFinished.length) * 100).round();
    return {
      'totalCorrect': correctCount,
      'totalChecked': todayFinished.length,
      'accuracy': overallAccuracy,
    };
  }
}

String _resolvePredictionText(
  Map<String, dynamic> data,
  Map<String, dynamic>? parsedJson,
) {
  final primaryReason = _asString(data['primary_reason'])?.trim() ?? '';
  if (primaryReason.isNotEmpty && !_looksLikeJson(primaryReason)) {
    return primaryReason;
  }

  final rawText = _asString(data['prediction_text'])?.trim() ?? '';
  if (rawText.isNotEmpty && !_looksLikeJson(rawText)) {
    return rawText;
  }

  final jsonSummary = _summaryFromJson(parsedJson);
  if (jsonSummary.isNotEmpty) {
    return jsonSummary;
  }

  final primary = PredictionRecord._pickFromData(data, 'primary_');
  final secondary = PredictionRecord._pickFromData(data, 'secondary_');
  final tertiary = PredictionRecord._pickFromData(data, 'tertiary_');

  final summaryParts = <String>[
    if (primary?.selection != null) primary!.selection!,
    if (primary?.market != null) '(${primary!.market})',
    if (primary?.reason != null) primary!.reason!,
    if (secondary?.selection != null) secondary!.selection!,
    if (secondary?.market != null) '(${secondary!.market})',
    if (secondary?.reason != null) secondary!.reason!,
    if (tertiary?.selection != null) tertiary!.selection!,
    if (tertiary?.market != null) '(${tertiary!.market})',
    if (tertiary?.reason != null) tertiary!.reason!,
  ];

  final summary = summaryParts.join(' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (summary.isNotEmpty) {
    return summary;
  }

  return 'Prediction details unavailable.';
}

bool _looksLikeJson(String value) {
  final trimmed = value.trimLeft();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

String _summaryFromJson(Map<String, dynamic>? json) {
  if (json == null) {
    return '';
  }

  final picks = json['picks'];
  if (picks is List && picks.isNotEmpty && picks.first is Map) {
    final firstPick = picks.first as Map;
    final selection = _asString(firstPick['selection'])?.trim() ?? '';
    final market = _asString(firstPick['market'])?.trim() ?? '';
    final reason = _asString(firstPick['reason'])?.trim() ?? '';

    final summaryParts = <String>[
      if (selection.isNotEmpty) selection,
      if (market.isNotEmpty) '($market)',
      if (reason.isNotEmpty) reason,
    ];

    if (summaryParts.isNotEmpty) {
      return summaryParts.join(' - ');
    }
  }

  final winner = _asString(json['predicted_winner'])?.trim() ?? '';
  if (winner.isNotEmpty) {
    return 'Predicted winner: $winner';
  }

  return '';
}

Map<String, dynamic> _normalizeRow(dynamic row) {
  if (row is Map<String, dynamic>) {
    final data = row['data'];
    if (data is Map<String, dynamic>) {
      return <String, dynamic>{
        ...data,
        if (row.containsKey(r'$id')) r'$id': row[r'$id'],
        if (row.containsKey(r'$createdAt')) r'$createdAt': row[r'$createdAt'],
        if (row.containsKey(r'$updatedAt')) r'$updatedAt': row[r'$updatedAt'],
      };
    }

    return row;
  }

  final dynamic data = row.data;
  if (data is Map<String, dynamic>) {
    return <String, dynamic>{
      ...data,
      if (row.$id != null) r'$id': row.$id,
      if (row.$createdAt != null) r'$createdAt': row.$createdAt,
      if (row.$updatedAt != null) r'$updatedAt': row.$updatedAt,
    };
  }

  return <String, dynamic>{};
}

String? _asString(Object? value) {
  if (value == null) {
    return null;
  }
  if (value is String) {
    return value;
  }
  return value.toString();
}

double? _asDouble(Object? value) {
  if (value == null) {
    return null;
  }
  if (value is num) {
    return value.toDouble();
  }
  return double.tryParse(value.toString());
}

DateTime? _asDateTime(Object? value) {
  final text = _asString(value);
  if (text == null || text.isEmpty) {
    return null;
  }
  return DateTime.tryParse(text);
}

bool _hasRenderablePrimaryPick(PredictionRecord prediction) {
  final selection = prediction.primaryPick?.selection?.trim() ?? '';
  return selection.isNotEmpty;
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

  final kickoffAt = prediction.kickoffAt?.toLocal();
  if (kickoffAt == null) {
    return false;
  }

  final finishedCutoff = kickoffAt.add(const Duration(minutes: 90));
  return now.isAfter(finishedCutoff);
}

int _comparePredictionsForDisplay(
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

bool isPopular(PredictionRecord p) {
  const popularClubs = [
    'Real Madrid', 'Manchester City', 'Liverpool',
    'Barcelona', 'Bayern Munich', 'Paris Saint-Germain',
    'Paris Saint‑Germain',
  ];
  final home = p.homeTeamName ?? '';
  final away = p.awayTeamName ?? '';
  final confidence = p.confidence ?? 0.0;
  return popularClubs.any((c) => home.toLowerCase().contains(c.toLowerCase()) || away.toLowerCase().contains(c.toLowerCase()))
      || confidence >= 0.85;
}

class _OverUnderSelectionLocal {
  const _OverUnderSelectionLocal({required this.isOver, required this.line});
  final bool isOver;
  final double line;
}

String _normalizeSelectionLocal(PredictionRecord p) {
  final selection = p.primaryPick?.selection?.trim() ?? '';
  if (selection.isNotEmpty) return _normalizeTextLocal(selection);
  final market = p.primaryPick?.market?.trim() ?? '';
  return _normalizeTextLocal(market);
}

String _normalizeTextLocal(String value) {
  return value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9.]+'), ' ').trim();
}

double? _goalCountLocal(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  return double.tryParse(value.trim());
}

_OverUnderSelectionLocal? _parseOverUnderSelectionLocal(String selection) {
  final match = RegExp(r'(over|under)\s*(\d+(?:\.\d+)?)').firstMatch(selection);
  if (match == null) return null;
  final line = double.tryParse(match.group(2) ?? '');
  if (line == null) return null;
  return _OverUnderSelectionLocal(isOver: match.group(1) == 'over', line: line);
}
