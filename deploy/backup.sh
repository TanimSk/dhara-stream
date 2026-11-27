#!/usr/bin/env bash
# Nightly Postgres dump (cron: 15 3 * * * /srv/dhara/deploy/backup.sh). Keeps 14 days.
# The database holds playlists and encrypted content keys: without it, stored videos can't play.
set -euo pipefail
dir=/var/backups/dhara
mkdir -p "$dir"
pg_dump -Fc dhara_stream > "$dir/dhara-$(date +%F).dump"
find "$dir" -name 'dhara-*.dump' -mtime +14 -delete
