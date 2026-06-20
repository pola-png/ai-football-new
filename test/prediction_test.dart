import 'package:flutter_test/flutter_test.dart';
import 'package:football_prediction_app/prediction_repository.dart';

void main() {
  group('Prediction Record & Repository Tests', () {
    test('isPopular returns true for elite popular club', () {
      final prediction = PredictionRecord(
        fixtureApiId: '101',
        modelName: 'AI Model v1',
        predictionText: 'Real Madrid to win',
        confidenceLabel: 'medium',
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Getafe',
        homeTeamLogoUrl: '',
        awayTeamLogoUrl: '',
        kickoffAt: DateTime.now(),
        matchStatusShort: 'NS',
        matchStatusLong: 'Not Started',
        primaryPick: const PredictionPick(
          market: 'Match Winner',
          selection: 'Real Madrid',
          confidence: 0.75,
          reason: 'Strong home performance.',
        ),
        secondaryPick: null,
        tertiaryPick: null,
        releaseAt: DateTime.now(),
        generatedAt: DateTime.now(),
        publishedAt: DateTime.now(),
        predictedWinner: 'Real Madrid',
        confidence: 0.75,
        market: 'Match Winner',
        matchOutcome: null,
        resultCheckedAt: null,
        currentHomeGoals: null,
        currentAwayGoals: null,
        fulltimeHomeGoals: null,
        fulltimeAwayGoals: null,
      );

      expect(isPopular(prediction), isTrue);
    });

    test('isPopular returns true for high confidence prediction', () {
      final prediction = PredictionRecord(
        fixtureApiId: '102',
        modelName: 'AI Model v1',
        predictionText: 'Over 2.5 goals',
        confidenceLabel: 'high',
        homeTeamName: 'Eibar',
        awayTeamName: 'Elche',
        homeTeamLogoUrl: '',
        awayTeamLogoUrl: '',
        kickoffAt: DateTime.now(),
        matchStatusShort: 'NS',
        matchStatusLong: 'Not Started',
        primaryPick: const PredictionPick(
          market: 'Total Goals',
          selection: 'Over 2.5',
          confidence: 0.88,
          reason: 'Attacking profiles.',
        ),
        secondaryPick: null,
        tertiaryPick: null,
        releaseAt: DateTime.now(),
        generatedAt: DateTime.now(),
        publishedAt: DateTime.now(),
        predictedWinner: null,
        confidence: 0.88,
        market: 'Total Goals',
        matchOutcome: null,
        resultCheckedAt: null,
        currentHomeGoals: null,
        currentAwayGoals: null,
        fulltimeHomeGoals: null,
        fulltimeAwayGoals: null,
      );

      expect(isPopular(prediction), isTrue);
    });

    test('isPopular returns false for normal club and medium confidence', () {
      final prediction = PredictionRecord(
        fixtureApiId: '103',
        modelName: 'AI Model v1',
        predictionText: 'Draw',
        confidenceLabel: 'medium',
        homeTeamName: 'Getafe',
        awayTeamName: 'Elche',
        homeTeamLogoUrl: '',
        awayTeamLogoUrl: '',
        kickoffAt: DateTime.now(),
        matchStatusShort: 'NS',
        matchStatusLong: 'Not Started',
        primaryPick: const PredictionPick(
          market: 'Match Winner',
          selection: 'Draw',
          confidence: 0.60,
          reason: 'Defensive styles.',
        ),
        secondaryPick: null,
        tertiaryPick: null,
        releaseAt: DateTime.now(),
        generatedAt: DateTime.now(),
        publishedAt: DateTime.now(),
        predictedWinner: null,
        confidence: 0.60,
        market: 'Match Winner',
        matchOutcome: null,
        resultCheckedAt: null,
        currentHomeGoals: null,
        currentAwayGoals: null,
        fulltimeHomeGoals: null,
        fulltimeAwayGoals: null,
      );

      expect(isPopular(prediction), isFalse);
    });
  });
}
