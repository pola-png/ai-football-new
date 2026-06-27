const String appwriteEndpoint = String.fromEnvironment(
  'APPWRITE_ENDPOINT',
  defaultValue: 'https://nyc.cloud.appwrite.io/v1',
);

const String appwriteProjectId = String.fromEnvironment(
  'APPWRITE_PROJECT_ID',
  defaultValue: '69652130002a7bb2081f',
);

const String appwriteDatabaseId = String.fromEnvironment(
  'APPWRITE_DATABASE_ID',
  defaultValue: '69f0cc60002fd9c7c29b',
);

const String appwritePredictionsTableId = String.fromEnvironment(
  'APPWRITE_PREDICTIONS_TABLE_ID',
  defaultValue: 'predictions',
);

const String appwriteFixturesTableId = String.fromEnvironment(
  'APPWRITE_FIXTURES_TABLE_ID',
  defaultValue: 'fixtures',
);

const String appwritePredictionTopicId = String.fromEnvironment(
  'APPWRITE_PREDICTION_TOPIC_ID',
  defaultValue: 'predictions',
);

const String appwriteUserProfilesTableId = String.fromEnvironment(
  'APPWRITE_USER_PROFILES_TABLE_ID',
  defaultValue: 'user_profiles',
);

const String appwritePredictionCommentsTableId = String.fromEnvironment(
  'APPWRITE_PREDICTION_COMMENTS_TABLE_ID',
  defaultValue: 'prediction_comments',
);

const String appwritePredictionSelectionsTableId = String.fromEnvironment(
  'APPWRITE_PREDICTION_SELECTIONS_TABLE_ID',
  defaultValue: 'prediction_selections',
);

const String appwriteChatMessagesTableId = String.fromEnvironment(
  'APPWRITE_CHAT_MESSAGES_TABLE_ID',
  defaultValue: 'chat_messages',
);

const String appwriteChatMessageLikesTableId = String.fromEnvironment(
  'APPWRITE_CHAT_MESSAGE_LIKES_TABLE_ID',
  defaultValue: 'chat_message_likes',
);

const String appwriteChatRoomId = String.fromEnvironment(
  'APPWRITE_CHAT_ROOM_ID',
  defaultValue: 'general',
);

const String appwriteDailyCheckinsTableId = String.fromEnvironment(
  'APPWRITE_DAILY_CHECKINS_TABLE_ID',
  defaultValue: 'daily_checkins',
);

const String appwritePredictionChallengesTableId = String.fromEnvironment(
  'APPWRITE_PREDICTION_CHALLENGES_TABLE_ID',
  defaultValue: 'prediction_challenges',
);

const String appwriteChallengeEntriesTableId = String.fromEnvironment(
  'APPWRITE_CHALLENGE_ENTRIES_TABLE_ID',
  defaultValue: 'challenge_entries',
);

const String appwriteAdminNotificationFunctionId = String.fromEnvironment(
  'APPWRITE_ADMIN_NOTIFICATION_FUNCTION_ID',
  defaultValue: '6a3e7c3b0022eeb7795a',
);

const String appwriteDeleteAccountFunctionId = String.fromEnvironment(
  'APPWRITE_DELETE_ACCOUNT_FUNCTION_ID',
  defaultValue: 'delete-account',
);
