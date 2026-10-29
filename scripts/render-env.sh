#!/usr/bin/env bash
# Prints app.env for deploy/compose.yaml (ADR-0004) from the variables and secrets the Deploy
# workflow takes from the GitHub environment. Unset or empty names are left out; the app refuses
# to start if one it needs is missing, and names it.
# Values are single-quoted so Compose takes them literally (no ${...} interpolation). A value
# with a quote or a newline is refused, naming the variable but never printing its value.
# Usage: scripts/render-env.sh > app.env
set -euo pipefail

NAMES=(
  APP_ORIGIN
  DATABASE_URL DATABASE_URL_DIRECT DATABASE_URL_MIGRATOR DB_CONNECTION_BUDGET
  STORAGE_ENDPOINT STORAGE_REGION STORAGE_BUCKET STORAGE_BACKUP_BUCKET
  STORAGE_ACCESS_KEY STORAGE_SECRET_KEY
  MAIL_FROM SMTP_URL SENDGRID_API_KEY SENDGRID_WEBHOOK_PUBLIC_KEY
  SESSION_SECRET CSRF_SECRET BACKUP_AGE_RECIPIENT
  GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET
  LIVE_PROVIDER GOOGLE_PROJECT_ID GOOGLE_SA_KEY_JSON_B64
  GOOGLE_PUBSUB_TOPIC GOOGLE_PUBSUB_SUBSCRIPTION GOOGLE_EVENTS_MODE
  VIDEO_HOST YOUTUBE_OAUTH_CLIENT_ID YOUTUBE_OAUTH_CLIENT_SECRET TOKEN_ENCRYPTION_KEY
  DRIVE_CLEANUP_MODE FEATURE_DIRECT_UPLOAD FEATURE_PHONE_DIAL_IN
)

for name in "${NAMES[@]}"; do
  value=${!name-}
  [[ -n "$value" ]] || continue
  if [[ "$value" == *"'"* || "$value" == *$'\n'* ]]; then
    echo "render-env: $name contains a quote or a newline" >&2
    exit 1
  fi
  printf "%s='%s'\n" "$name" "$value"
done
