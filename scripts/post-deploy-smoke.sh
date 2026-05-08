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

# Pool factory + app liveness. /api/health is slim by default since
# Wave 8 #3 (PR #80) — `"database":"ok"` only appears in the detailed
# shape behind `X-Health-Detail: $HEALTH_DETAIL_SECRET`. Smoke uses
# the slim path: `"status":"ok"` is enough to confirm the app is up
# and the route handler is healthy. Detailed shape is exercised by
# the GitHub Actions uptime probe which holds the secret as a repo
# secret.
check GET /api/health 200 '"status":"ok"'

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

# Codex review 2026-05-09 / Wave 11 PR 1.2-3 — nonce-based CSP smoke.
# The whole strict CSP depends on `app/layout.tsx` reading
# `(await headers()).get('x-nonce')` to trigger Next.js auto-stamping.
# If anyone "cleans up" that read, framework-emitted inline scripts
# lose their nonces, the browser refuses them, hydration breaks. This
# block catches that regression.
#
# We assert per surface:
#   1. Content-Security-Policy header is present
#   2. CSP `script-src` does NOT contain `'unsafe-inline'`
#   3. `script-src` carries a nonce (`'nonce-...'` token)
#   4. At least one inline `<script>` in the rendered HTML carries
#      `nonce=`. Empty inline-script count is acceptable for some
#      surfaces; non-empty + zero-nonced is the regression we want
#      to catch.
#
# Surfaces chosen to cover the dimensions Codex named: home (RSC
# payload heavy), `/pay` (loads CloudPayments external script),
# `/admin/login` (gated route different render path), `/does-not-exist`
# (404 surface, exercises our own `app/not-found.tsx`).

check_csp_nonce() {
  local path="$1"
  local headers_file
  headers_file="$(mktemp -t lc-smoke-headers.XXXXXX)"

  curl -sS -o "$TMP_BODY" -D "$headers_file" \
    --max-time 10 "$BASE_URL$path" >/dev/null 2>&1 \
    || { printf '  FAIL  CSP-NONCE  %-30s curl failed\n' "$path"; rm -f "$headers_file"; FAILS=$((FAILS + 1)); return; }

  local csp_line
  csp_line=$(grep -i '^content-security-policy:' "$headers_file" | head -1 || true)
  if [ -z "$csp_line" ]; then
    printf '  FAIL  CSP-NONCE  %-30s no Content-Security-Policy header\n' "$path"
    FAILS=$((FAILS + 1)); rm -f "$headers_file"; return
  fi

  if printf '%s' "$csp_line" | grep -oE "script-src [^;]*" | grep -q "'unsafe-inline'"; then
    printf '  FAIL  CSP-NONCE  %-30s script-src contains '\''unsafe-inline'\''\n' "$path"
    FAILS=$((FAILS + 1)); rm -f "$headers_file"; return
  fi

  if ! printf '%s' "$csp_line" | grep -oE "script-src [^;]*" | grep -q "'nonce-"; then
    printf '  FAIL  CSP-NONCE  %-30s script-src missing nonce token\n' "$path"
    FAILS=$((FAILS + 1)); rm -f "$headers_file"; return
  fi

  local inline_total inline_nonced
  inline_total=$(grep -oE '<script[^>]*>' "$TMP_BODY" | grep -vc 'src=' || true)
  inline_nonced=$(grep -oE '<script[^>]*>' "$TMP_BODY" | grep -v 'src=' | grep -c 'nonce=' || true)

  if [ "$inline_total" -gt 0 ] && [ "$inline_nonced" -eq 0 ]; then
    printf '  FAIL  CSP-NONCE  %-30s %s inline scripts, 0 nonced — auto-stamp trigger broken\n' \
      "$path" "$inline_total"
    FAILS=$((FAILS + 1)); rm -f "$headers_file"; return
  fi

  printf '  ok    CSP-NONCE  %-30s inline=%s nonced=%s\n' "$path" "$inline_total" "$inline_nonced"
  rm -f "$headers_file"
}

# 5 surfaces per Codex review §1.
check_csp_nonce /
check_csp_nonce /pay
check_csp_nonce /offer
check_csp_nonce /admin/login
check_csp_nonce /this-route-does-not-exist-404

if [ "$FAILS" -gt 0 ]; then
  echo "=== smoke FAILED: $FAILS check(s) ==="
  exit 1
fi

echo "=== smoke PASSED ==="
