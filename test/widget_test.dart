// This is a basic Flutter widget test.

import 'package:flutter_test/flutter_test.dart';
import 'package:football_prediction_app/main.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  setUpAll(() async {
    // Initialize Supabase for testing
    await Supabase.initialize(
      url: 'https://test.supabase.co',
      anonKey: 'test-anon-key',
    );
  });

  testWidgets('App starts with AuthScreen when not logged in', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const AuthWrapper());

    // Verify that the AuthScreen is present.
    expect(find.byType(AuthScreen), findsOneWidget);
    expect(find.text('Welcome Back'), findsOneWidget);
  });
}