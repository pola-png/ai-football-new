import 'dart:convert';

import 'package:appwrite/appwrite.dart';

import 'appwrite_config.dart';

class PredictionPick {
  const PredictionPick({
    required this.market,
    required this.selection,
    required this.confidence,
    required this.reason,
  });

  final String? market;
  final String? selection;
  final double? confidence;
  final String? reason;

  factory PredictionPick.fromMap(Map<String, dynamic> data, String prefix) {
    return PredictionPick(
      market: _asString(data['${prefix}market']),
      selection: _asString(data['${prefix}selection']),
      confidence: _asDouble(data['${prefix}confidence']),
      reason: _asString(data['${prefix}reason']),
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
      primaryPick: _pickFromData(data, 'primary_'),
      secondaryPick: _pickFromData(data, 'secondary_'),
      tertiaryPick: _pickFromData(data, 'tertiary_'),
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
    );
  }

  static PredictionPick? _pickFromData(Map<String, dynamic> data, String prefix) {
    final market = _asString(data['${prefix}market']);
    final selection = _asString(data['${prefix}selection']);
    final confidence = _asDouble(data['${prefix}confidence']);
    final reason = _asString(data['${prefix}reason']);

    if (market == null && selection == null && confidence == null && reason == null) {
      return null;
    }

    return PredictionPick(
      market: market,
      selection: selection,
      confidence: confidence,
      reason: reason,
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
      Query.orderDesc('kickoff_at'),
      Query.orderDesc('release_at'),
    ]);

    final filtered = rows.where(_hasRenderablePrimaryPick).toList();
    filtered.sort(_comparePredictionsForDisplay);
    return filtered;
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
