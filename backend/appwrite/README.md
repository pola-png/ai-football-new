# Appwrite backend plan

This folder defines the backend shape for the football prediction app.

Database name:

- `ai_football_betting_prediction_db`

Project values:

- `APPWRITE_DATABASE_ID=69f0cc60002fd9c7c29b`
- `APPWRITE_PROJECT_ID=69652130002a7bb2081f`
- `APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1`

## What this backend does

1. Fetches the next 100 fixtures from API-Football.
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

Flutter app config:

- `APPWRITE_ENDPOINT`
- `APPWRITE_PROJECT_ID`

Optional:

- `API_FOOTBALL_SEASON`
- `API_FOOTBALL_LEAGUE`

## Tables

See [`schema.md`](./schema.md) for the exact tables and columns.

For the app to read data directly from Appwrite, give `teams`, `leagues`, `fixtures`, `predictions`, and `results` read access for `Any` at the table level or equivalent row-level permissions. Keep `sync_runs` private.

## Functions

Deploy only these two functions on Appwrite Free:

- `sync-and-generate`
- `generate-and-publish`

Do not deploy `sync-fixtures`, `generate-predictions`, `publish-predictions`, or `cleanup-raw-fetch` separately on the Free plan.

`sync-and-generate` is responsible for:

- deleting old raw rows first
- fetching upcoming matches
- saving or updating teams
- saving or updating leagues
- saving or updating fixtures
- keeping team logos in the backend

`generate-and-publish` is responsible for:

- reading the latest successful `sync_run_id`
- loading only the fixtures in that batch
- loading odds and h2h rows for each fixture
- calling DeepSeek
- saving only prediction rows into `predictions`
- storing 2 to 3 structured picks per fixture
- focusing the picks on low-odds markets like over, under, gg, corners, double chance, and throw-ins when available
- publishing draft predictions whose `release_at` is due
- marking them as `published`
- setting `published_at`
- sending a push notification through Appwrite Messaging

## Fetch schedule

- Run the cleanup step at `2:00 pm`.
- Run the sync step at `7:00 pm`.
- The sync step should fetch the fresh batch and store it in Appwrite with one `sync_run_id`.
- `generate-and-publish` should run after sync, not at the same time.

## Cleanup schedule

- Clean up the raw fetch tables at `2:00 pm`.
- Do not delete `predictions` or `results` during this cleanup.
- This keeps the raw fetch tables empty before the next sync.

## Publish schedule

- Run `generate-and-publish` after sync finishes.
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
