#!/usr/bin/env bash
#
# Smoke-boot regression harness — discovered 2026-06-03 first staging
# cold-start (PR #507).
#
# Why this exists:
#
#   `scripts/seccomp-regression-check.sh` proves SystemCallFilter is
#   compatible with Node startup (`node -e 'await import("pg")'`).
#   It does NOT prove the FULL hardening posture of
#   `levelchannel-staging.service` is compatible with Next.js's
#   complete boot path. The 2026-06-03 staging activation discovered
#   two regressions the seccomp test missed:
#
#     - `MemoryDenyWriteExecute=true` crashes Node 20 V8 baseline JIT
#       (`OS::SetPermissions` mprotects pages W↔X; status 5/TRAP).
#     - `RestrictAddressFamilies` without `AF_NETLINK` causes
#       `uv_interface_addresses` → EAFNOSUPPORT; Next 16
#       `start-server.js` post-listen callback throws and never
#       registers the request handler. Port listens, all TCP
#       connections time out.
#
#   Both regressions are silent in `build-check` (CI runs `next build`
#   but never `next start`, and CI runners have no hardening at all).
#
# What this script does:
#
#   1. Parse `ops/staging/systemd/levelchannel-staging.service` for
#      every hardening directive in the [Service] section.
#   2. Build the equivalent `systemd-run --property=...` flags.
#   3. Boot `node_modules/.bin/next start --port 3199` as a transient
#      systemd unit under those properties.
#   4. Poll `http://127.0.0.1:3199/api/health` for up to 60 s,
#      asserting:
#        - the unit stays active (no crash loop)
#        - `/api/health` returns 200
#        - `.status == "ok"`
#        - `.environment == "smoke"` (set via LC_ENV)
#   5. Stop the transient unit on exit.
#
# Where this is meant to run:
#
#   - GitHub Actions Ubuntu runner via `.github/workflows/smoke-boot.yml`.
#   - Ad-hoc on any Linux dev box with systemd-run + node + a built
#     `.next/`: `DATABASE_URL=... bash scripts/smoke-boot-check.sh`.
#   - On macOS / non-systemd hosts the script politely skips with
#     exit 0.
#
# Prerequisite: caller has already run `npm ci` + `npm run build` so
# `.next/BUILD_ID` exists and `node_modules/.bin/next` is on disk.

set -uo pipefail

# Skip on non-Linux / no systemd-run.
if [ "$(uname -s)" != "Linux" ]; then
  echo "[smoke-boot] skip: not Linux ($(uname -s))"
  exit 0
fi
if ! command -v systemd-run >/dev/null 2>&1; then
  echo "[smoke-boot] skip: systemd-run not available"
  exit 0
fi

# Sudo wrapper. systemd-run system-level needs root; CI / prod have
# sudo. Local dev with `sudo -n` failing means we skip.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  else
    echo "[smoke-boot] skip: not root and sudo not available without password"
    exit 0
  fi
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

UNIT_FILE="${UNIT_FILE:-ops/staging/systemd/levelchannel-staging.service}"
PORT="${SMOKE_PORT:-3199}"
TRANSIENT_UNIT="lc-smoke-boot-$$"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/postgres}"
LC_ENV_VALUE="smoke"

if [ ! -f "$UNIT_FILE" ]; then
  echo "FAIL  unit file not found: $UNIT_FILE" >&2
  exit 1
fi

if [ ! -x node_modules/.bin/next ]; then
  echo "FAIL  node_modules/.bin/next missing — run \`npm ci\` first" >&2
  exit 1
fi

if [ ! -f .next/BUILD_ID ]; then
  echo "FAIL  .next/BUILD_ID missing — run \`npm run build\` first" >&2
  exit 1
fi

# Resolve the absolute node binary path. `systemd-run` ignores the
# calling shell's PATH (it uses the systemd default
# `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`),
# so `/usr/bin/env node` from the next CLI's shebang would resolve
# to whatever `/usr/bin/node` ships on the host instead of the
# actions/setup-node-pinned version. We bypass the shebang by
# calling `$NODE_BIN $NEXT_ENTRY start ...` directly. NEXT_ENTRY
# is the actual Next.js CLI module under node_modules/next/dist/bin/
# (the `node_modules/.bin/next` symlink chain causes
# MODULE_NOT_FOUND on Node 22 when invoked as the entry script
# under systemd-run; verified 2026-06-03 on ubuntu-24.04).
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  echo "FAIL  node not found in PATH" >&2
  exit 1
fi

NEXT_ENTRY="$REPO_ROOT/node_modules/next/dist/bin/next"
if [ ! -f "$NEXT_ENTRY" ]; then
  echo "FAIL  next entry not found at $NEXT_ENTRY" >&2
  exit 1
fi
echo "[smoke-boot] using node at: $NODE_BIN ($($NODE_BIN --version))"
echo "[smoke-boot] using next entry: $NEXT_ENTRY"

# Extract hardening directives. Only known-good keys are forwarded
# to systemd-run; ExecStart / User / EnvironmentFile / Type live
# elsewhere in the file and we set our own.
#
# Deliberately omitted:
#
#   ProtectHome / ProtectSystem / ReadWritePaths — filesystem-only
#   hardening. They DON'T cause the V8/libuv class of crashes this
#   smoke exists to catch; they restrict reads/writes. In CI the
#   working tree lives under /home/runner/work/, which ProtectHome=
#   true makes invisible to the unit — `next start` can't even
#   exec (status=203/EXEC). The actual filesystem hardening posture
#   is verified by the prod unit's runtime behaviour and
#   integration-tests; dropping them here keeps the smoke focused on
#   the syscall/memory/network layers that prior CI missed.
HARDENING_KEYS=(
  NoNewPrivileges
  PrivateTmp
  PrivateDevices
  ProtectKernelTunables
  ProtectKernelModules
  ProtectControlGroups
  RestrictAddressFamilies
  RestrictNamespaces
  LockPersonality
  MemoryDenyWriteExecute
  RestrictRealtime
  SystemCallArchitectures
  SystemCallFilter
  CapabilityBoundingSet
  AmbientCapabilities
)

PROPS=()
while IFS='=' read -r key val; do
  for k in "${HARDENING_KEYS[@]}"; do
    if [ "$key" = "$k" ]; then
      PROPS+=(--property="$key=$val")
      break
    fi
  done
done < <(
  awk '/^\[Service\]/{flag=1;next} /^\[/{flag=0} flag' "$UNIT_FILE" \
    | sed -E 's/[[:space:]]+#.*$//' \
    | grep -vE '^[[:space:]]*#' \
    | grep -E '^[A-Za-z][A-Za-z0-9]*='
)

echo "[smoke-boot] applying ${#PROPS[@]} hardening properties from $UNIT_FILE"
printf '  %s\n' "${PROPS[@]}"

cleanup() {
  $SUDO systemctl stop "$TRANSIENT_UNIT.service" 2>/dev/null || true
  # If the unit failed it stays "failed" until reset.
  $SUDO systemctl reset-failed "$TRANSIENT_UNIT.service" 2>/dev/null || true
}
trap cleanup EXIT

# No ReadWritePaths override needed — ProtectSystem isn't in the
# extracted set (see HARDENING_KEYS rationale above), so the unit's
# default filesystem permissions apply and /home/runner/work + CWD
# stay writable for Next's runtime cache.

echo "[smoke-boot] booting $NODE_BIN $NEXT_ENTRY start --port $PORT under transient unit $TRANSIENT_UNIT"

SETENV_FLAGS=(
  --setenv=NODE_ENV=production
  --setenv=LC_ENV="$LC_ENV_VALUE"
  --setenv=PORT="$PORT"
  --setenv=DATABASE_URL="$DATABASE_URL"
  --setenv=NEXT_PUBLIC_SITE_URL="http://127.0.0.1:$PORT"
  --setenv=NEXT_PUBLIC_LC_ENV="$LC_ENV_VALUE"
)

# Pass through optional caller-provided env vars (PAYMENTS_*,
# DB_SSL, HEALTH_DETAIL_SECRET) so the workflow can wire them in
# without changing the script. Only forward when set — keeps the
# script self-contained for local dev.
for var in PAYMENTS_PROVIDER PAYMENTS_STORAGE_BACKEND DB_SSL HEALTH_DETAIL_SECRET; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    SETENV_FLAGS+=(--setenv="$var=$val")
  fi
done

if ! $SUDO systemd-run \
    --unit="$TRANSIENT_UNIT" \
    --collect \
    "${SETENV_FLAGS[@]}" \
    "${PROPS[@]}" \
    -- "$NODE_BIN" "$NEXT_ENTRY" start --port "$PORT" >/tmp/smoke-boot-launch.log 2>&1; then
  echo "FAIL  systemd-run could not start transient unit" >&2
  cat /tmp/smoke-boot-launch.log >&2
  exit 1
fi

# Poll /api/health for up to 60s. Bail early if the unit died.
DEADLINE=$((SECONDS + 60))
BODY=""
HTTP_CODE=""
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  if ! $SUDO systemctl is-active "$TRANSIENT_UNIT.service" >/dev/null 2>&1; then
    echo "FAIL  transient unit died during boot" >&2
    $SUDO journalctl -u "$TRANSIENT_UNIT.service" --no-pager -n 60 >&2 || true
    exit 1
  fi
  HTTP_CODE=$(curl -s -m2 -o /tmp/smoke-boot-body \
                   -w '%{http_code}' \
                   "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    BODY=$(cat /tmp/smoke-boot-body)
    break
  fi
  sleep 2
done

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL  /api/health did not return 200 within 60s (last code: $HTTP_CODE)" >&2
  $SUDO journalctl -u "$TRANSIENT_UNIT.service" --no-pager -n 60 >&2 || true
  exit 1
fi

if ! printf '%s' "$BODY" | grep -q '"status":"ok"'; then
  echo "FAIL  /api/health body missing status:ok (got: $BODY)" >&2
  exit 1
fi

if ! printf '%s' "$BODY" | grep -q "\"environment\":\"$LC_ENV_VALUE\""; then
  echo "FAIL  /api/health environment field != $LC_ENV_VALUE (got: $BODY)" >&2
  exit 1
fi

echo "[smoke-boot] PASS — /api/health 200 + status:ok + environment:$LC_ENV_VALUE"
echo "[smoke-boot] body: $BODY"
