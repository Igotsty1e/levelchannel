#!/bin/bash
#
# One-shot activator for the operator-side of every recently shipped
# observability + retention feature. Run as root on the production VPS,
# from the repo working tree at __LEVELCHANNEL_APP_DIR__:
#
#   ssh -i ~/.ssh/__LEVELCHANNEL_SSH_KEY__ root@__LEVELCHANNEL_PROD_IP__
#   cd __LEVELCHANNEL_APP_DIR__
#   bash scripts/activate-prod-ops.sh
#
# What it does (every step is IDEMPOTENT — re-running is a no-op if
# the change is already applied):
#
#   1. Append missing env vars to __LEVELCHANNEL_ENV_FILE__:
#        ALERT_EMAIL_TO, OPERATOR_NOTIFY_EMAIL,
#        SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN
#      Existing lines are NOT overwritten — only missing keys appended.
#
#   2. Patch __LEVELCHANNEL_AUTODEPLOY__ so the deployed
#      app reports the SHA it was built from:
#        - inserts `export GIT_SHA=$(git rev-parse HEAD)` before
#          the `npm run build` line
#        - inserts a sed-update of GIT_SHA in __LEVELCHANNEL_ENV_FILE__
#          so the systemd-managed app process sees the SHA on the
#          NEXT run after this swap
#      Backs up the original to .bak-<timestamp> before editing.
#
#   3. Copy systemd unit + timer files into /etc/systemd/system:
#        levelchannel-webhook-flow-alert.{service,timer}
#        levelchannel-db-retention.{service,timer}
#      `cp -n` so existing files aren't clobbered. If you need to
#      pick up a newer reference unit, delete the existing file
#      first or use --force.
#
#   4. systemctl daemon-reload, enable --now both timers,
#      restart levelchannel (so SENTRY_DSN + OPERATOR_NOTIFY_EMAIL
#      land in env immediately).
#
# Reads no secrets from outside the repo. The Sentry DSN is hardcoded
# below — it's the project's public DSN (browser-side anyway), not a
# secret in the harmful sense. Auth tokens / API keys are NOT here.

set -euo pipefail

# Colors only when stdout is a tty (don't pollute logs).
if [ -t 1 ]; then
  G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; B=$'\033[1m'; N=$'\033[0m'
else
  G=''; Y=''; R=''; B=''; N=''
fi

step() { echo "${B}==> $*${N}"; }
ok()   { echo "${G}    ✓ $*${N}"; }
skip() { echo "${Y}    · $*${N}"; }
warn() { echo "${R}    ! $*${N}" >&2; }

if [ "$(id -u)" != "0" ]; then
  warn "must run as root (sudo bash scripts/activate-prod-ops.sh)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="__LEVELCHANNEL_ENV_FILE__"
AUTODEPLOY="__LEVELCHANNEL_AUTODEPLOY__"
SYSTEMD_DIR="/etc/systemd/system"

if [ ! -f "$ENV_FILE" ]; then
  warn "$ENV_FILE not found — is the production tree set up?"
  exit 1
fi

# ── 1. ENV VARS ──────────────────────────────────────────────────────────────
step "Append missing env vars to $ENV_FILE"

declare -a env_kv=(
  "ALERT_EMAIL_TO=masteryprojectss@gmail.com"
  "OPERATOR_NOTIFY_EMAIL=masteryprojectss@gmail.com"
  "SENTRY_DSN=https://515c38afb2a6ec1ac375e5024e5b12c9@o4511303482212352.ingest.de.sentry.io/4511303502528593"
  "NEXT_PUBLIC_SENTRY_DSN=https://515c38afb2a6ec1ac375e5024e5b12c9@o4511303482212352.ingest.de.sentry.io/4511303502528593"
)

ENV_CHANGED=0
for kv in "${env_kv[@]}"; do
  key="${kv%%=*}"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    skip "$key already set, leaving as is"
  else
    printf '%s\n' "$kv" >> "$ENV_FILE"
    ok "appended $key"
    ENV_CHANGED=1
  fi
done

chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

# ── 2. AUTODEPLOY PATCH (GIT_SHA) ────────────────────────────────────────────
step "Patch $AUTODEPLOY for GIT_SHA export"

if [ ! -f "$AUTODEPLOY" ]; then
  warn "$AUTODEPLOY not found — skipping (deploy-freshness will stay inactive)"
elif grep -qE '^[[:space:]]*export GIT_SHA=' "$AUTODEPLOY"; then
  skip "autodeploy already exports GIT_SHA"
else
  TS=$(date +%Y%m%d%H%M%S)
  BACKUP="${AUTODEPLOY}.bak-${TS}"
  cp -p "$AUTODEPLOY" "$BACKUP"
  ok "backed up to $BACKUP"

  # Inject GIT_SHA export at the right point in the autodeploy script.
  # Production script structure:
  #   ...
  #   target_sha=$(git ls-remote ...)        ← already validated above
  #   ...
  #   set -a
  #   source __LEVELCHANNEL_ENV_FILE__
  #   set +a                                  ← OUR INSERT POINT (after)
  #   env -u NODE_ENV npm run build           ← fallback insert (before)
  #
  # We anchor on `set +a` first so our `export GIT_SHA=...` lands in the
  # already-exported scope (otherwise sourcing the env-file would override
  # us mid-stream). If `set +a` isn't there, we fall back to inserting
  # immediately before any `npm run build` line (with optional `env`
  # prefix in production, or bare in earlier shapes).
  python3 - "$AUTODEPLOY" <<'PYPATCH'
import sys, re, pathlib
p = pathlib.Path(sys.argv[1])
text = p.read_text()

# Try `set +a` anchor first (insert AFTER); fall back to npm run build
# (insert BEFORE).
anchor_after = re.search(r'^([\t ]*)set \+a[\t ]*$', text, re.M)
anchor_before = re.search(
    r'^([\t ]*)(?:env [^\n]*? )?npm run build\b', text, re.M
)

if anchor_after:
    insert_after = True
    match = anchor_after
elif anchor_before:
    insert_after = False
    match = anchor_before
else:
    sys.stderr.write(
        "ERROR: could not find an insertion anchor in autodeploy script.\n"
        "Looked for `set +a` and `npm run build` lines.\n"
    )
    sys.exit(1)

indent = match.group(1)
patch = (
    f"\n"
    f"{indent}# Inject the deployed commit SHA into env so /api/health.version\n"
    f"{indent}# reports it; deploy-freshness GitHub Action compares against main.\n"
    f"{indent}# `target_sha` is already defined + validated above; fall back to\n"
    f"{indent}# git rev-parse HEAD if for some reason it's empty.\n"
    f"{indent}export GIT_SHA=\"${{target_sha:-$(git rev-parse HEAD)}}\"\n"
    f"{indent}if grep -qE '^GIT_SHA=' __LEVELCHANNEL_ENV_FILE__; then\n"
    f"{indent}  sed -i \"s|^GIT_SHA=.*|GIT_SHA=$GIT_SHA|\" __LEVELCHANNEL_ENV_FILE__\n"
    f"{indent}else\n"
    f"{indent}  echo \"GIT_SHA=$GIT_SHA\" >> __LEVELCHANNEL_ENV_FILE__\n"
    f"{indent}fi\n"
)

if insert_after:
    # Insert after the end of the matched line (preserving its newline).
    cut = match.end()
    nl = text.find('\n', cut)
    if nl == -1:
        nl = len(text)
    new = text[: nl + 1] + patch + text[nl + 1 :]
else:
    new = text[: match.start()] + patch + "\n" + text[match.start() :]

p.write_text(new)
print("patched")
PYPATCH

  if grep -qE '^[[:space:]]*export GIT_SHA=' "$AUTODEPLOY"; then
    ok "autodeploy patched"
  else
    warn "patch did not take — restoring backup"
    cp -p "$BACKUP" "$AUTODEPLOY"
    exit 1
  fi
fi

# ── 3. SYSTEMD UNIT FILES ────────────────────────────────────────────────────
step "Install systemd unit + timer files"

declare -a units=(
  "levelchannel-webhook-flow-alert.service"
  "levelchannel-webhook-flow-alert.timer"
  "levelchannel-db-retention.service"
  "levelchannel-db-retention.timer"
)

UNITS_CHANGED=0
for u in "${units[@]}"; do
  src="$REPO_ROOT/scripts/systemd/$u"
  dst="$SYSTEMD_DIR/$u"
  if [ ! -f "$src" ]; then
    warn "$src missing in repo — skip"
    continue
  fi
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    skip "$u already in place + identical"
    continue
  fi
  cp -p "$src" "$dst"
  chmod 644 "$dst"
  ok "installed $u"
  UNITS_CHANGED=1
done

# ── 4. SYSTEMCTL DAEMON RELOAD + ENABLE TIMERS + RESTART APP ────────────────
step "systemd reload + enable timers"

if [ "$UNITS_CHANGED" = "1" ]; then
  systemctl daemon-reload
  ok "daemon-reload"
else
  skip "no unit file changes, skipping daemon-reload"
fi

declare -a timers=(
  "levelchannel-webhook-flow-alert.timer"
  "levelchannel-db-retention.timer"
)

for t in "${timers[@]}"; do
  if systemctl is-enabled "$t" >/dev/null 2>&1; then
    skip "$t already enabled"
  else
    if systemctl enable --now "$t"; then
      ok "enabled + started $t"
    else
      warn "failed to enable $t — check 'systemctl status $t'"
    fi
  fi
done

step "Restart levelchannel app to pick up new env"

if [ "$ENV_CHANGED" = "1" ]; then
  systemctl restart levelchannel
  sleep 2
  if systemctl is-active levelchannel >/dev/null 2>&1; then
    ok "levelchannel restarted, active"
  else
    warn "levelchannel did not come back active — check journalctl -u levelchannel"
    exit 1
  fi
else
  skip "no env changes, app restart unnecessary"
fi

# ── 5. POST-RUN STATUS ──────────────────────────────────────────────────────
step "Post-activation summary"

echo
echo "${B}Active timers:${N}"
systemctl list-timers --no-pager 2>/dev/null \
  | grep -E "levelchannel-(webhook-flow-alert|db-retention)" \
  || echo "  (timers not yet shown — they appear after first scheduled run)"

echo
echo "${B}Sentry smoke (run manually after this script finishes):${N}"
echo "  node -e \"const S=require('@sentry/nextjs'); S.init({dsn:process.env.SENTRY_DSN}); S.captureMessage('manual smoke '+Date.now()); S.flush(5000).then(()=>process.exit(0));\""
echo
echo "${B}/api/health.version after next deploy:${N}"
echo "  curl -s https://levelchannel.ru/api/health | jq .version"
echo "  Should report a SHA matching origin/main HEAD within ~5 min"
echo "  of the next push (autodeploy runs once per minute)."
echo

ok "DONE"
