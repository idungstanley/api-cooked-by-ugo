#!/usr/bin/env bash
# Runs on the VM every minute from cron. It pulls main and, if anything changed, builds and
# restarts the API. Pulling means the VM needs no open ports for deploys.
#
#   * * * * * /home/ubuntu/api-cooked-by-ugo/scripts/auto-deploy.sh >> /home/ubuntu/deploy.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
exec 9>/tmp/cooked-by-ugo-deploy.lock
flock -n 9 || exit 0

git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
  exit 0
fi

echo "$(date -u +%FT%TZ) deploying $(git rev-parse --short origin/main)"
git reset --quiet --hard origin/main
npm ci --include=dev --no-audit --no-fund
npm run build
# A failed build stops above, so the running version keeps serving customers.
pm2 reload ecosystem.config.cjs --update-env
echo "$(date -u +%FT%TZ) deployed"
