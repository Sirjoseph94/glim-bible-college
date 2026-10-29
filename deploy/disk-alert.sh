#!/bin/sh
# Emails the System Admin when the VPS's disk is nearly full (TRD §20.1, docs/runbooks/server.md).
# Run daily by root from /etc/cron.d/glim-disk-alert:
#   0 7 * * * root /opt/glim/disk-alert.sh admin@example.org
# It sends through Brevo with the app's own SMTP_URL and sender, read from /opt/glim/app.env.
# The URL holds the SMTP key, so it goes to curl in a config file, never on the command line.
set -eu
to=${1:?usage: disk-alert.sh <email>}
limit=85

used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
[ "$used" -lt "$limit" ] && exit 0

env=/opt/glim/app.env
url=$(sed -n "s/^SMTP_URL='\(.*\)'$/\1/p" "$env")
sender=$(sed -n "s/^MAIL_FROM='\(.*\)'$/\1/p" "$env")
from=$(echo "$sender" | sed 's/.*<\(.*\)>.*/\1/')
host=$(hostname)

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
chmod 700 "$dir"
printf 'From: %s\r\nTo: %s\r\nSubject: GLIM server disk %s%% full\r\n\r\nThe disk on %s is %s%% full. Free space: docker system prune (see docs/runbooks/server.md).\r\n' \
  "$sender" "$to" "$used" "$host" "$used" > "$dir/message"
printf 'url = "%s"\nmail-from = "%s"\nmail-rcpt = "%s"\nupload-file = "%s"\n' \
  "$url" "$from" "$to" "$dir/message" > "$dir/curl.conf"

curl --fail --silent --show-error --ssl-reqd --config "$dir/curl.conf"
