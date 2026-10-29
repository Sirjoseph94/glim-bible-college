#!/usr/bin/env bash
# Deploys GLIM on the VPS (ADR-0004, docs/runbooks/deploy.md). Run from /opt/glim by the Deploy
# workflow, or by hand:
#   ./deploy.sh <image>      migrate, then replace api1, api2 and the worker one at a time
#   ./deploy.sh --rollback   go back to the image before the last deploy, without migrating
# Rolling back never migrates: changes are expand/contract (TRD §22.6), so the previous image
# works with the newer database.
set -euo pipefail
cd "$(dirname "$0")"

current_image() { sed -n 's/^IMAGE=//p' .env 2>/dev/null || true; }

if [[ "${1:-}" == "--rollback" ]]; then
  image=$(cat previous-image 2>/dev/null || true)
  [[ -n "$image" ]] || { echo "deploy: no previous image is recorded" >&2; exit 1; }
  migrate=false
else
  image=${1:?usage: deploy.sh <image> | --rollback}
  migrate=true
fi

[[ -f app.env ]] || { echo "deploy: app.env is missing (run the Deploy workflow)" >&2; exit 1; }
domain=$(sed -n "s#^APP_ORIGIN='https://\([^/']*\).*#\1#p" app.env)
[[ -n "$domain" ]] || { echo "deploy: APP_ORIGIN in app.env must be https://<domain>" >&2; exit 1; }

before=$(current_image)
printf 'IMAGE=%s\nAPP_DOMAIN=%s\n' "$image" "$domain" > .env

docker pull --quiet "$image"

if $migrate && ! docker compose run --rm migrate; then
  echo "deploy: migrations failed; the running version is unchanged" >&2
  [[ -n "$before" ]] && printf 'IMAGE=%s\nAPP_DOMAIN=%s\n' "$before" "$domain" > .env
  exit 1
fi

# One API container at a time; Caddy sends requests to the healthy one meanwhile.
for service in api1 api2; do
  if ! docker compose up -d --no-deps --wait --wait-timeout 180 "$service"; then
    echo "deploy: $service didn't become healthy; run ./deploy.sh --rollback" >&2
    exit 1
  fi
done
docker compose up -d --no-deps worker
docker compose up -d --no-deps caddy

[[ -n "$before" && "$before" != "$image" ]] && echo "$before" > previous-image

# Keep two weeks of images so a rollback doesn't have to pull.
docker image prune --all --force --filter "until=336h" > /dev/null
echo "deploy: running $image"
