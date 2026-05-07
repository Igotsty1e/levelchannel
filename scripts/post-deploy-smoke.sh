#!/usr/bin/env bash
#
# A2 from the smoke-blind-spot lesson backlog. Hits a known set of
# critical routes after deploy and asserts each returns the expected
# HTTP status (and, where load-bearing, a body fragment). Fails loud
# on any mismatch — exit 1 — so a 500-ing prod can't ship silently.
#
# What it catches that /api/health alone doesn't:
#   - route handlers that 500 on first hit (e.g. lazy module-init
#     failures in lib/ that don't surface until a real request)
#   - auth gate logic regressions (admin / learner role ladders)
#   - middleware misconfiguration (origin checks, sec-fetch-site)
#   - route file moves / Next.js routing-table drift
#
# Usage:
#
#   bash scripts/post-deploy-smoke.sh                       # default: prod
#   bash scripts/post-deploy-smoke.sh https://levelchannel.ru
#   bash scripts/post-deploy-smoke.sh http://127.0.0.1:3000  # local dev
#
# Wiring:
#
#   The autodeploy script on the VPS should invoke this AFTER restart
#   and BEFORE returning success. A non-zero exit means the deploy
#   replaced a working build with a broken one — operator should
#   roll back per OPERATIONS.md before debugging in place.
#
# Why bash + curl, not Node: zero install footprint, runs on any box
# with a shell, no version drift on the runner. The cost of a smoke
# script that depends on its own dependency tree is higher than the
# cost of a few extra lines of bash.

set -uo pipefail

BASE_URL="${1:-https://levelchannel.ru}"
TMP_BODY="$(mktemp -t lc-smoke-body.XXXXXX)"
trap 'rm -f "$TMP_BODY"' EXIT

FAILS=0

check() {
  local method="$1"
  local path="$2"
  local expected_code="$3"
  local body_must_contain="${4:-}"

  local actual_code
  actual_code=$(curl -sS -X "$method" -o "$TMP_BODY" -w "%{http_code}" \
    --max-time 10 "$BASE_URL$path" 2>/dev/null) || actual_code="curl-error"

  if [ "$actual_code" != "$expected_code" ]; then
    printf '  FAIL  %-7s %-30s expected=%s actual=%s\n' \
      "$method" "$path" "$expected_code" "$actual_code"
    FAILS=$((FAILS + 1))
    return
  fi

  if [ -n "$body_must_contain" ]; then
    if ! grep -q -- "$body_must_contain" "$TMP_BODY"; then
      printf '  FAIL  %-7s %-30s body missing %s\n' \
        "$method" "$path" "$body_must_contain"
      FAILS=$((FAILS + 1))
      return
    fi
  fi

  printf '  ok    %-7s %-30s %s\n' "$method" "$path" "$actual_code"
}

echo "=== post-deploy smoke against $BASE_URL ==="

# Pool factory + DB liveness. /api/health goes through the shared
# getDbPool() now (ops/health-onto-shared-pool, 2026-05-07), so any
# regression in lib/db/pool.ts also fails this check.
check GET /api/health 200 '"database":"ok"'

# Auth surface — anon should never see authenticated content.
check GET /api/auth/me 401
check GET /login 200
check GET /register 200
check GET /forgot 200
check GET /cabinet 307
check GET /verify-pending 200

# Admin surface — anon should redirect to /admin/login.
check GET /admin/login 200
check GET /admin/slots 307

# Public payment surface still serves anonymous calls per the loose
# contract.
check GET /api/slots/available 200
check GET /thank-you 200

if [ "$FAILS" -gt 0 ]; then
  echo "=== smoke FAILED: $FAILS check(s) ==="
  exit 1
fi

echo "=== smoke PASSED ==="
