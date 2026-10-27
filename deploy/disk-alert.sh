#!/bin/sh
# Emails the System Admin when the VPS's disk is nearly full (TRD §20.1, docs/runbooks/server.md).
# Run daily by root from /etc/cron.d/glim-disk-alert:
#   0 7 * * * root /opt/glim/disk-alert.sh admin@example.org
# It sends through SendGrid with the app's own key and sender, read from /opt/glim/app.env.
set -eu
to=${1:?usage: disk-alert.sh <email>}
limit=85

used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$used" -lt "$limit" ] && exit 0

env=/opt/glim/app.env
key=$(sed -n "s/^SENDGRID_API_KEY='\(.*\)'$/\1/p" "$env")
from=$(sed -n "s/^MAIL_FROM='\(.*\)'$/\1/p" "$env" | sed 's/.*<\(.*\)>.*/\1/')
host=$(hostname)

curl --fail --silent --show-error https://api.sendgrid.com/v3/mail/send \
  -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
  -d "{\"personalizations\":[{\"to\":[{\"email\":\"$to\"}]}],\"from\":{\"email\":\"$from\"},\"subject\":\"GLIM server disk ${used}% full\",\"content\":[{\"type\":\"text/plain\",\"value\":\"The disk on $host is ${used}% full. Free space: docker system prune (see docs/runbooks/server.md).\"}]}"
