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

const String appwritePredictionTopicId = String.fromEnvironment(
  'APPWRITE_PREDICTION_TOPIC_ID',
  defaultValue: 'predictions',
);
