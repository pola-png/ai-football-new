# Appwrite Database Schema

Database name:

- `ai_football_betting_prediction_db`

Use one Appwrite database with the tables below.

## Table Permissions

- Give read access to `teams`, `leagues`, `fixtures`, `fixture_odds`, `fixture_h2h_history`, `predictions`, and `results` so the Flutter app can read published data.
- Keep `sync_runs` private.
- Keep write access limited to Appwrite Functions.

## `teams`

Stores each football team once.

Columns:

- `api_team_id` `text` required unique indexed
- `name` `text` required indexed
- `code` `text` optional
- `country` `text` optional indexed
- `founded` `text` optional
- `national` `boolean` required default `false`
- `logo_url` `url` optional
- `created_at` `datetime` required
- `updated_at` `datetime` required

## `leagues`

Stores league and competition data.

Columns:

- `api_league_id` `text` required unique indexed
- `name` `text` required indexed
- `country` `text` optional indexed
- `type` `text` optional
- `logo_url` `url` optional
- `flag_url` `url` optional
- `season` `text` optional indexed
- `created_at` `datetime` required
- `updated_at` `datetime` required

## `fixtures`

Stores the raw batch of fixtures fetched from API-Football.

Columns:

- `api_fixture_id` `text` required unique indexed
- `league_api_id` `text` required indexed
- `season` `text` required indexed
- `round` `text` optional indexed
- `kickoff_at` `datetime` required indexed
- `status_short` `text` required indexed
- `status_long` `text` optional
- `home_team_api_id` `text` required indexed
- `away_team_api_id` `text` required indexed
- `home_team_name` `text` required
- `away_team_name` `text` required
- `home_team_logo_url` `url` optional
- `away_team_logo_url` `url` optional
- `venue_name` `text` optional
- `venue_city` `text` optional
- `odds_summary` `mediumtext` optional
- `h2h_summary` `mediumtext` optional
- `sync_run_id` `text` required indexed
- `processed` `boolean` required default `false`
- `processed_at` `datetime` optional indexed
- `delete_after_at` `datetime` optional indexed
- `created_at` `datetime` required
- `updated_at` `datetime` required

Notes:

- Use `sync_run_id` to group one fetch batch.
- A cleanup function should delete all raw rows in this table around `2:00 pm`.

## `fixture_odds`

Stores betting odds snapshots for each fixture.

Columns:

- `fixture_api_id` `text` required indexed
- `bookmaker_name` `text` required indexed
- `bookmaker_api_id` `text` optional indexed
- `market_name` `text` required indexed
- `selection_name` `text` required
- `odd_value` `float` required
- `line_value` `text` optional
- `last_update_at` `datetime` optional
- `created_at` `datetime` required
- `updated_at` `datetime` required

## `fixture_h2h_history`

Stores historical head-to-head fixtures for the same pairing.

Columns:

- `current_fixture_api_id` `text` required indexed
- `historical_fixture_api_id` `text` required unique indexed
- `home_team_api_id` `text` required indexed
- `away_team_api_id` `text` required indexed
- `kickoff_at` `datetime` required indexed
- `home_score` `text` optional
- `away_score` `text` optional
- `winner` `text` optional indexed
- `status_short` `text` required indexed
- `league_api_id` `text` optional indexed
- `season` `text` optional indexed
- `created_at` `datetime` required
- `updated_at` `datetime` required

## `predictions`

Stores DeepSeek prediction output.

Columns:

- `fixture_api_id` `text` required unique indexed
- `model_name` `text` required
- `prediction_text` `mediumtext` required
- `prediction_json` `mediumtext` required
- `predicted_winner` `text` optional indexed
- `confidence` `float` optional
- `market` `text` optional
- `confidence_label` `text` optional
- `primary_market` `text` optional
- `primary_selection` `text` optional
- `primary_confidence` `float` optional
- `primary_reason` `mediumtext` optional
- `secondary_market` `text` optional
- `secondary_selection` `text` optional
- `secondary_confidence` `float` optional
- `secondary_reason` `mediumtext` optional
- `tertiary_market` `text` optional
- `tertiary_selection` `text` optional
- `tertiary_confidence` `float` optional
- `tertiary_reason` `mediumtext` optional
- `match_status_short` `text` optional
- `match_status_long` `text` optional
- `current_home_goals` `text` optional
- `current_away_goals` `text` optional
- `halftime_home_goals` `text` optional
- `halftime_away_goals` `text` optional
- `fulltime_home_goals` `text` optional
- `fulltime_away_goals` `text` optional
- `extratime_home_goals` `text` optional
- `extratime_away_goals` `text` optional
- `penalty_home_goals` `text` optional
- `penalty_away_goals` `text` optional
- `match_outcome` `text` optional
- `result_checked_at` `datetime` optional
- `odds_summary` `mediumtext` optional
- `h2h_summary` `mediumtext` optional
- `release_status` `text` required
- `release_at` `datetime` required indexed
- `generated_at` `datetime` required
- `published_at` `datetime` optional
- `notification_sent` `boolean` required default `false`
- `notification_sent_at` `datetime` optional
- `created_at` `datetime` required
- `updated_at` `datetime` required

Suggested values for `release_status`:

- `draft`
- `published`
- `archived`

## `results`

Stores final match outcomes after API-Football confirms the result.

Columns:

- `fixture_api_id` `text` required unique indexed
- `home_score` `text` optional
- `away_score` `text` optional
- `winner` `text` optional indexed
- `outcome` `text` required
- `checked_at` `datetime` optional
- `final_status` `text` optional
- `created_at` `datetime` required
- `updated_at` `datetime` required

Suggested values for `outcome`:

- `pending`
- `win`
- `loss`
- `push`
- `void`

## `sync_runs`

Stores each backend job run for debugging and auditing.

Columns:

- `job_name` `text` required indexed
- `sync_run_id` `text` optional indexed
- `status` `text` required
- `started_at` `datetime` required
- `finished_at` `datetime` optional
- `items_seen` `text` required default `0`
- `items_saved` `text` required default `0`
- `message` `mediumtext` optional
- `created_at` `datetime` required
- `updated_at` `datetime` required

Suggested values for `status`:

- `success`
- `failed`
- `partial`

## Recommended Flow

1. `cleanup-raw-fetch` deletes old raw fetch rows around `2:00 pm`.
2. `sync-fixtures` fetches the fixtures for the current date at `7:00 pm`.
3. It keeps only fixtures that have both odds and head-to-head data, then saves the merged fixture row, odds, and h2h history.
4. `generate-predictions` reads only the latest `sync_run_id`.
5. It saves only prediction rows to `predictions`.
6. `publish-predictions` changes due drafts to `published` and sends notifications.
