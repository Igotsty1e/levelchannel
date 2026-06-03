#!/usr/bin/env bash
# Staging autodeploy — runs as the levelchannel-staging user every minute.
#
# Pulls `staging` branch, stops the unit (start of brief downtime
# window), updates files, builds, restarts unit, smoke-probes externally.
#
# Operator install: this file is invoked by
# `levelchannel-staging-autodeploy.service`. Place under
# /srv/levelchannel-staging/ops/staging/scripts/ (the staging git
# clone's working tree).
#
# DOWNTIME WINDOW: ~60-120s during deploy. Acceptable for staging
# (tolerates brief unavailability; the staging-uptime probe runs every
# 15 min so flaps don't open noisy issues). Prod uses a more elaborate
# swap; we don't need it here.
#
# Fail-safe: if anything between fetch + build fails BEFORE stop, the
# currently-running staging keeps serving. If the build fails AFTER
# stop, staging stays down until the next tick — the operator can see
# this in journalctl + the staging-uptime probe will open an issue.
#
# State machine:
#
#   1. git fetch + log new SHA
#   2. if HEAD == deployed → exit 0 (nothing to do)
#   3. systemctl stop levelchannel-staging.service       (downtime starts)
#   4. git reset --hard origin/staging
#   5. npm ci
#   6. npm run migrate:up                                (against staging DB)
#   7. export GIT_SHA + npm run build                    (with full env file)
#   8. systemctl start levelchannel-staging.service      (downtime ends)
#   9. wait 5s + smoke against https://staging.levelchannel.ru
#  10. write deployed-sha state file

set -euo pipefail

LOG_PREFIX="[autodeploy-staging $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
log() { echo "$LOG_PREFIX $*"; }

cd /srv/levelchannel-staging

DEPLOYED_SHA_FILE=/var/lib/levelchannel-staging/deployed-sha
DEPLOYED_SHA=$(cat "$DEPLOYED_SHA_FILE" 2>/dev/null || echo "")

log "fetching origin/staging"
git fetch --depth 50 origin staging

NEW_SHA=$(git rev-parse origin/staging)
log "current deployed=${DEPLOYED_SHA:-<none>} new=$NEW_SHA"

if [ "$NEW_SHA" = "$DEPLOYED_SHA" ]; then
  log "no change, exit"
  exit 0
fi

# Source the env file so the build sees NEXT_PUBLIC_* and other
# build-time values (legal env vars, Sentry plugin token, etc.).
# Without this, `next build` runs under just DATABASE_URL + GIT_SHA
# and produces a bundle missing client-side legal config.
if [ -f /etc/levelchannel-staging/env ]; then
  log "sourcing /etc/levelchannel-staging/env for build env"
  set -a
  # shellcheck disable=SC1091
  . /etc/levelchannel-staging/env
  set +a
else
  log "FAIL  /etc/levelchannel-staging/env missing — refusing to build"
  exit 1
fi

log "stopping levelchannel-staging.service (downtime window starts)"
# Fail loud if stop fails — we MUST NOT touch the running unit's files
# in-place. The most likely cause is a sudoers/unit-wiring drift; the
# operator needs to see it surface as a failed autodeploy tick rather
# than silently mutating /srv/levelchannel-staging under the live app.
sudo /bin/systemctl stop levelchannel-staging.service

log "checking out staging at $NEW_SHA"
git reset --hard "$NEW_SHA"

log "npm ci"
npm ci --no-audit --no-fund

log "applying migrations against staging DB"
npm run migrate:up

log "building (GIT_SHA=$NEW_SHA)"
export GIT_SHA="$NEW_SHA"
npm run build

log "starting levelchannel-staging.service (downtime window ends)"
sudo /bin/systemctl start levelchannel-staging.service

log "waiting 5s for startup"
sleep 5

log "post-restart smoke against staging.levelchannel.ru"
if ! bash scripts/post-deploy-smoke.sh https://staging.levelchannel.ru; then
  log "post-restart smoke FAILED — staging serving NEW SHA but unhealthy"
  log "operator: investigate journalctl -u levelchannel-staging.service --since 5min ago"
  exit 1
fi

# Persist deployed SHA only after smoke confirms healthy.
# /var/lib/levelchannel-staging is in ReadWritePaths of the
# autodeploy unit; pre-created by the operator at Step 3 of
# docs/staging-setup.md.
echo "$NEW_SHA" > "$DEPLOYED_SHA_FILE"
log "swap complete; staging now on $NEW_SHA"
