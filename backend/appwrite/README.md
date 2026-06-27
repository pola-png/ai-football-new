# Appwrite backend plan

This folder defines the backend shape for the football prediction app.

Database name:

- `ai_football_betting_prediction_db`

Project values:

- `APPWRITE_DATABASE_ID=69f0cc60002fd9c7c29b`
- `APPWRITE_PROJECT_ID=69652130002a7bb2081f`
- `APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1`

## What this backend does

1. Fetches the daily fixtures for the current date from API-Football.
2. Saves teams, leagues, and fixtures into Appwrite tables.
3. Stores team logos with each team row.
4. Saves odds snapshots and h2h history into separate backend tables.
5. Passes the fixture, odds, and h2h context to DeepSeek for prediction.
6. Saves only the prediction output into the database.

## Environment variables

Set these in the Appwrite Function settings:

- `APPWRITE_DATABASE_ID`
- `APPWRITE_PROJECT_ID`
- `APPWRITE_FUNCTION_ENDPOINT`
- `APPWRITE_FUNCTION_PROJECT_ID`
- `APPWRITE_FUNCTION_API_KEY`

Secret key note:

- Use your Appwrite API key as `APPWRITE_FUNCTION_API_KEY`.
- That key is what allows the backend functions to write, update, and delete rows in the project database.
- `API_FOOTBALL_BASE_URL`
- `API_FOOTBALL_KEY`
- `API_FOOTBALL_HOST`
- `APPWRITE_TABLE_TEAMS`
- `APPWRITE_TABLE_LEAGUES`
- `APPWRITE_TABLE_FIXTURES`
- `APPWRITE_TABLE_PREDICTIONS`
- `APPWRITE_TABLE_FIXTURE_ODDS`
- `APPWRITE_TABLE_FIXTURE_H2H_HISTORY`
- `APPWRITE_TABLE_SYNC_RUNS`

Prediction-specific:

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

Notification-specific:

- `APPWRITE_TOPIC_PREDICTIONS`

Push provider note:

- Firebase Admin credentials must be configured for direct FCM topic sends.
- Set either `FIREBASE_SERVICE_ACCOUNT_JSON` or the split `FIREBASE_SERVICE_ACCOUNT_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL`, and `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` values.
- If the private key is missing or malformed, notification sends will fail with a JWT encode error.
- The app can subscribe successfully and still receive nothing until that credential is fixed.
- When this is set correctly, the publish functions can send to `APPWRITE_TOPIC_PREDICTIONS` normally.

Flutter app config:

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`

Optional:

- `API_FOOTBALL_DATE`
- `API_FOOTBALL_LEAGUE`

## Tables

See [`schema.md`](./schema.md) for the exact tables and columns.

For the app to read data directly from Appwrite, give `teams`, `leagues`, `fixtures`, `predictions`, and `results` read access for `Any` at the table level or equivalent row-level permissions. Keep `sync_runs` private.

## Functions

Recommended split for the current codebase:

- `daily-sync-generate`
- `generate-predictions`
- `publish-and-maintain` if you still want a publish/reconcile pass
- `delete-account` for permanent account deletion and user-data cleanup

Function responsibilities:

`daily-sync-generate`

- deleting old raw rows first
- keeping only prediction rows for yesterday, today, and tomorrow
- fetching upcoming matches
- saving or updating teams
- saving or updating leagues
- saving or updating fixtures
- keeping team logos in the backend

`generate-predictions`

- reading the latest successful `sync_run_id`
- loading all fixtures from the `fixtures` table
- paging through the full fixtures table, not just the first page
- loading odds and h2h rows for each fixture
- calling DeepSeek
- saving only prediction rows into `predictions`
- storing one best structured pick per fixture
- keeping confidence at 80% or higher
- never deleting existing prediction rows during generation
- focusing the picks on low-odds markets like over, under, gg, corners, double chance, and throw-ins when available
- publishing draft predictions whose `release_at` is due
- marking them as `published`
- setting `published_at`
- sending a push notification directly through Firebase Cloud Messaging

`publish-and-maintain`

- publishing any remaining drafts that are due
- refreshing final match outcomes
- keeping the predictions table in sync with live results

Optional batch setting:

- `APPWRITE_PREDICTION_CONCURRENCY`
- Default is `1`, which processes fixtures one after the other.
- Set it higher if you want multiple fixtures handled at the same time.

Account deletion function:

- `delete-account` expects an authenticated function execution from the signed-in user.
- Configure `APPWRITE_FUNCTION_ENDPOINT`, `APPWRITE_FUNCTION_PROJECT_ID`, `APPWRITE_FUNCTION_API_KEY`, `APPWRITE_DATABASE_ID`, and either `APPWRITE_FUNCTION_USER_ID` or `APPWRITE_FUNCTION_JWT`.
- The function removes rows from `user_profiles`, `prediction_comments`, `prediction_selections`, `daily_checkins`, and `challenge_entries` before deleting the auth account.

## Fetch schedule

- Run the cleanup step at `2:00 pm`.
- Run the sync step at `7:00 pm`.
- The sync step should fetch the fresh batch and store it in Appwrite with one `sync_run_id`.
- `publish-and-maintain` should run after sync, not at the same time.

## Cleanup schedule

- Clean up the raw fetch tables at `2:00 pm`.
- Do not delete `predictions` or `results` during this cleanup.
- This keeps the raw fetch tables empty before the next sync.
- Preserve `fixture_h2h_history` so historical pairing data stays available for later predictions.

## Publish schedule

- Run `publish-and-maintain` after sync finishes.
- Publish only draft predictions whose `release_at` is due.
- On each run it will:
  1. Check the latest sync batch.
  2. Generate predictions only for fixtures that do not already have a prediction row.
  3. Save those predictions in Appwrite.
  4. Publish only draft predictions whose `release_at` is due.
  5. Send a push notification after the rows are published.

## Simple timing plan

- `2:00 pm`: cleanup
- `7:00 pm`: sync
- after sync: generate
- when due: publish

## Appwrite Function Setup

For `generate-predictions` use:

- Runtime: `node-25`
- Entrypoint: `src/index.js`
- Root directory: `backend/appwrite/functions/generate-predictions/`
- Build command: `npm install`

Required environment variables:

- `APPWRITE_DATABASE_ID`
- `APPWRITE_FUNCTION_ENDPOINT`
- `APPWRITE_FUNCTION_PROJECT_ID`
- `APPWRITE_FUNCTION_API_KEY`
- `APPWRITE_TABLE_FIXTURES`
- `APPWRITE_TABLE_FIXTURE_ODDS`
- `APPWRITE_TABLE_FIXTURE_H2H_HISTORY`
- `APPWRITE_TABLE_PREDICTIONS`
- `APPWRITE_TABLE_SYNC_RUNS`
- `APPWRITE_TOPIC_PREDICTIONS`
- `API_FOOTBALL_BASE_URL`
- `API_FOOTBALL_KEY`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`
- `FIREBASE_SERVICE_ACCOUNT_JSON` or the split Firebase service-account env vars
