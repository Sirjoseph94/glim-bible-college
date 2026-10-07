#!/usr/bin/env bash
# Renders an App Platform spec: substitutes only the listed variables, so App Platform's own
# bindings such as ${db.glim-tx.DATABASE_URL} pass through untouched.
# Usage: scripts/render-app-spec.sh .do/app.yaml > /tmp/app.rendered.yaml
set -euo pipefail
VARS='$IMAGE_TAG $APP_ORIGIN $STAGING_APP_ORIGIN $STORAGE_BUCKET $STORAGE_BACKUP_BUCKET $MAIL_FROM
$SENDGRID_WEBHOOK_PUBLIC_KEY $GOOGLE_OAUTH_CLIENT_ID $BACKUP_AGE_RECIPIENT $SECRET_DATABASE_URL_MIGRATOR
$SECRET_STORAGE_ACCESS_KEY $SECRET_STORAGE_SECRET_KEY $SECRET_SENDGRID_API_KEY
$SECRET_GOOGLE_OAUTH_CLIENT_SECRET $SECRET_SESSION_SECRET $SECRET_CSRF_SECRET'
envsubst "$VARS" < "$1"
