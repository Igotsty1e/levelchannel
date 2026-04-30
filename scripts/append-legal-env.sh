#!/bin/bash
#
# Append missing NEXT_PUBLIC_LEGAL_* env vars to the production env file.
#
# Why: PR #40 introduced lib/legal/public-profile.ts which throws at
# build time when any of these vars are missing under NODE_ENV=production
# (or NEXT_PHASE=phase-production-build). On a fresh server that has never
# seen these vars, `npm run build` fails and the systemd-managed
# autodeploy refuses to swap, so prod stays on the previous SHA.
#
# Run on prod as root, in the repo working tree, with the operator's
# real values supplied via env:
#
#   NEXT_PUBLIC_LEGAL_OPERATOR_NAME="..." \
#   NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY="..." \
#   NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID="..." \
#   NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL="..." \
#   NEXT_PUBLIC_LEGAL_BANK_ACCOUNT="..." \
#   NEXT_PUBLIC_LEGAL_BANK_NAME="..." \
#   NEXT_PUBLIC_LEGAL_BANK_BIK="..." \
#   NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT="..." \
#   NEXT_PUBLIC_LEGAL_BANK_CITY="..." \
#   bash scripts/append-legal-env.sh
#
# Idempotent: existing keys are NOT overwritten. If you typo'd a value,
# edit the production env file by hand, then re-run the deploy command.
#
# After a successful run, trigger one deploy cycle with DEPLOY_COMMAND:
#   DEPLOY_COMMAND="/path/to/autodeploy" bash scripts/append-legal-env.sh
# or wait for the cron tick. /api/health.version will then move to the
# new GIT_SHA and the deploy-stale GitHub issue auto-closes on the next
# deploy-freshness run.

set -euo pipefail

ENV_FILE="${ENV_FILE:-/path/to/app.env}"
DEPLOY_COMMAND="${DEPLOY_COMMAND:-deploy command}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE does not exist. Set ENV_FILE=... if it's elsewhere." >&2
  exit 1
fi

LEGAL_KEYS=(
  NEXT_PUBLIC_LEGAL_OPERATOR_NAME
  NEXT_PUBLIC_LEGAL_OPERATOR_DISPLAY
  NEXT_PUBLIC_LEGAL_OPERATOR_TAX_ID
  NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL
  NEXT_PUBLIC_LEGAL_BANK_ACCOUNT
  NEXT_PUBLIC_LEGAL_BANK_NAME
  NEXT_PUBLIC_LEGAL_BANK_BIK
  NEXT_PUBLIC_LEGAL_BANK_CORR_ACCOUNT
  NEXT_PUBLIC_LEGAL_BANK_CITY
)

# Verify all values were supplied via env before touching the file.
missing=()
for key in "${LEGAL_KEYS[@]}"; do
  val="${!key:-}"
  if [ -z "$val" ]; then
    missing+=("$key")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "ERROR: the following env values were not supplied to this script:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "" >&2
  echo "Re-run with all 9 NEXT_PUBLIC_LEGAL_* / NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL values" >&2
  echo "set in the environment. See script header for the recipe." >&2
  exit 1
fi

changed=0
for key in "${LEGAL_KEYS[@]}"; do
  val="${!key}"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    echo "skip: $key already set in $ENV_FILE"
    continue
  fi
  # Wrap in double quotes, escape only \ and ". This format is understood by
  # both systemd EnvironmentFile= and Next.js dotenv loader, and keeps Cyrillic
  # / spaces / punctuation intact (printf %q would emit $'…' which systemd
  # treats as a literal string, mangling non-ASCII).
  escaped="${val//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$escaped" >> "$ENV_FILE"
  echo "ok:   appended $key"
  changed=1
done

if [ "$changed" = "1" ]; then
  echo ""
  echo "Done. Now trigger one deploy cycle:"
  echo "  $DEPLOY_COMMAND"
  echo ""
  echo "/api/health.version will then move from 6e18300… to the current main SHA."
else
  echo ""
  echo "No changes. All NEXT_PUBLIC_LEGAL_* keys were already present in $ENV_FILE."
fi
