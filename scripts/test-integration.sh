#!/bin/bash
# Integration test runner. Brings up Docker Postgres, runs migrations,
# executes vitest, tears down.
#
# Usage: npm run test:integration
#
# Requires: Docker engine in PATH (Docker Desktop on macOS).
#
# Why real Postgres (not pg-mem): /plan-eng-review D5 — FOR UPDATE row
# locks, jsonb operators, FK cascades, CHECK constraints all behave
# identically to prod (postgres:16.13 matches OPERATIONS.md §1 exactly).
# pg-mem skips lock semantics, which would let the single-use-token
# replay test pass falsely.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker-compose.test.yml"
DB_URL="postgresql://levelchannel_test:levelchannel_test@127.0.0.1:54329/levelchannel_test?sslmode=disable"

# Auto-detect Docker socket. Default is /var/run/docker.sock on Linux and
# Docker Desktop. Colima (lightweight macOS runtime) sockets live under
# ~/.colima/default/. We probe and export DOCKER_HOST if the default
# socket is missing but a known alternative exists.
if [ -z "${DOCKER_HOST:-}" ] && [ ! -S /var/run/docker.sock ]; then
  if [ -S "$HOME/.colima/default/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  elif [ -S "$HOME/.docker/run/docker.sock" ]; then
    export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
  fi
fi

cleanup() {
  echo "===tearing down test postgres==="
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "===bringing up postgres-test==="
docker compose -f "$COMPOSE_FILE" up -d --wait

echo "===waiting for postgres ready (timeout 30s)==="
for _ in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres-test \
       pg_isready -U levelchannel_test -d levelchannel_test >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  sleep 1
done

echo "===applying migrations==="
DATABASE_URL="$DB_URL" npm run migrate:up

echo "===running integration tests==="
DATABASE_URL="$DB_URL" \
  AUTH_RATE_LIMIT_SECRET="lc-test-rate-limit-secret-32-chars-min" \
  TELEMETRY_HASH_SECRET="lc-test-telemetry-secret-32-chars-min" \
  TEST_INTEGRATION=1 \
  npx vitest run --config vitest.integration.config.ts "$@"
