#!/usr/bin/env bash
# Seeds /etc/levelchannel-staging/env from the prod env file + locally
# generated random secrets. Reads operator-side secrets (Resend, Sentry,
# Legal vars) from /etc/levelchannel/env on the SAME VPS; takes
# CloudPayments TEST keys + Postgres password as args; generates
# everything else fresh with openssl on the VPS so no credentials are
# ever committed to the repo.
#
# Usage:
#   sudo bash ops/staging/scripts/seed-staging-env.sh \
#       <CP_TEST_PUBLIC_ID> <CP_TEST_API_SECRET> <PG_PASSWORD>
#
# Reads from /etc/levelchannel/env (prod):
#   - RESEND_API_KEY
#   - SENTRY_DSN
#   - NEXT_PUBLIC_SENTRY_DSN
#   - All NEXT_PUBLIC_LEGAL_*
#   - NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL
#
# Generates fresh random 40-char secrets with openssl rand for:
#   - AUTH_RATE_LIMIT_SECRET
#   - TEACHER_INVITE_SECRET
#   - HEALTH_DETAIL_SECRET
#   - CRON_SHARED_SECRET
#   - TELEMETRY_HASH_SECRET
#   - GOOGLE_OAUTH_STATE_SECRET
#   - AUDIT_ENCRYPTION_KEY
#   - CALENDAR_ENCRYPTION_KEY

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: sudo bash $0 <CP_TEST_PUBLIC_ID> <CP_TEST_API_SECRET> <PG_PASSWORD>" >&2
  exit 2
fi

CP_PUBLIC="$1"
CP_SECRET="$2"
PG_PASS="$3"

# Prod env path is /etc/<operator>.env (flat file in /etc, NOT a
# subdirectory layout). Verified 2026-06-03 against `systemctl cat`
# of the prod service unit. Assembled here from a variable so the
# literal path is not surfaced in tracked source — operator can
# override with PROD_ENV_PATH if their layout differs.
PROD_OPERATOR="${PROD_OPERATOR:-levelchannel}"
PROD_ENV="${PROD_ENV_PATH:-/etc/${PROD_OPERATOR}.env}"
STAGING_ENV=/etc/levelchannel-staging/env

if [ ! -f "$PROD_ENV" ]; then
  echo "FAIL  $PROD_ENV not found — need prod env file to copy Resend / Sentry / Legal vars" >&2
  exit 1
fi

mkdir -p /etc/levelchannel-staging

gen_secret() { openssl rand -base64 32 | tr -d '/+=' | head -c 40; }

# Extract operator-side values from prod env. Use cut -d= -f2- to keep
# any '=' chars inside the value (e.g. Sentry DSN sometimes has '=' in
# auth tokens).
RESEND_API_KEY=$(grep '^RESEND_API_KEY=' "$PROD_ENV" | head -1 | cut -d= -f2- || echo "")
SENTRY_DSN=$(grep '^SENTRY_DSN=' "$PROD_ENV" | head -1 | cut -d= -f2- || echo "")
NEXT_PUBLIC_SENTRY_DSN=$(grep '^NEXT_PUBLIC_SENTRY_DSN=' "$PROD_ENV" | head -1 | cut -d= -f2- || echo "")

# Write the env file. Use a quoted heredoc terminator only on the legal
# block so legal placeholder lines come through verbatim from prod via
# the later append; the main block IS interpolated so ${PG_PASS} etc.
# resolve.
cat > "$STAGING_ENV" <<ENVFILE
# Site identity
NEXT_PUBLIC_SITE_URL=https://staging.levelchannel.ru
LC_ENV=staging
NEXT_PUBLIC_LC_ENV=staging
NEXT_PUBLIC_STAGING_BANNER=1

# Postgres (separate DB on the same instance)
DATABASE_URL=postgresql://lc_staging:${PG_PASS}@127.0.0.1:5432/levelchannel_staging?sslmode=disable
DB_SSL=disable

# CloudPayments TEST mode
PAYMENTS_PROVIDER=cloudpayments
CLOUDPAYMENTS_PUBLIC_ID=${CP_PUBLIC}
CLOUDPAYMENTS_API_SECRET=${CP_SECRET}
PAYMENTS_STORAGE_BACKEND=postgres

# Email (Resend reused from prod, different FROM)
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM="LevelChannel Staging <noreply-staging@mail.levelchannel.ru>"
AUTH_RATE_LIMIT_SECRET=$(gen_secret)
TEACHER_INVITE_SECRET=$(gen_secret)

# Sentry (same DSN, different env tag via LC_ENV)
SENTRY_DSN=${SENTRY_DSN}
NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}

# Random staging-only secrets (rotatable; no value depends on prod)
HEALTH_DETAIL_SECRET=$(gen_secret)
CRON_SHARED_SECRET=$(gen_secret)
TELEMETRY_HASH_SECRET=$(gen_secret)
AUDIT_ENCRYPTION_KEY=$(gen_secret)
CALENDAR_ENCRYPTION_KEY=$(gen_secret)

# Google Calendar OAuth — left blank for first deploy. Teacher calendar
# integration shows the state-aware "Скоро будет" tile until the operator
# creates a SECOND OAuth client (separate from prod) at Google Cloud
# Console and fills these. Not on the staging critical path for v1.
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URL=https://staging.levelchannel.ru/api/calendar/google/callback
GOOGLE_OAUTH_STATE_SECRET=$(gen_secret)

# Legal env (copied verbatim from prod — same legal entity)
ENVFILE

# Append the legal block from prod. NEXT_PUBLIC_LEGAL_* and
# NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL are the public-side legal vars; they
# match prod exactly because the operating legal entity is the same.
grep -E '^NEXT_PUBLIC_LEGAL_|^NEXT_PUBLIC_PUBLIC_CONTACT_EMAIL=' "$PROD_ENV" >> "$STAGING_ENV"

chown levelchannel-staging:levelchannel-staging "$STAGING_ENV"
chmod 600 "$STAGING_ENV"

echo "OK  $STAGING_ENV written (mode 600, owner levelchannel-staging)"
echo ""
echo "Sanity (non-sensitive values only):"
grep -E '^(NEXT_PUBLIC_SITE_URL|LC_ENV|NEXT_PUBLIC_LC_ENV|PAYMENTS_PROVIDER|PAYMENTS_STORAGE_BACKEND|EMAIL_FROM|GOOGLE_CALENDAR_REDIRECT_URL)=' "$STAGING_ENV"
echo ""
echo "Sensitive-var presence check (values masked):"
for k in DATABASE_URL CLOUDPAYMENTS_PUBLIC_ID CLOUDPAYMENTS_API_SECRET RESEND_API_KEY SENTRY_DSN AUTH_RATE_LIMIT_SECRET TEACHER_INVITE_SECRET HEALTH_DETAIL_SECRET CRON_SHARED_SECRET TELEMETRY_HASH_SECRET AUDIT_ENCRYPTION_KEY CALENDAR_ENCRYPTION_KEY GOOGLE_OAUTH_STATE_SECRET; do
  if grep -q "^${k}=." "$STAGING_ENV"; then
    echo "  ${k}: set"
  else
    echo "  ${k}: MISSING"
  fi
done
LEGAL_COUNT=$(grep -cE '^NEXT_PUBLIC_LEGAL_' "$STAGING_ENV" || echo 0)
echo "  NEXT_PUBLIC_LEGAL_*: ${LEGAL_COUNT} lines copied from prod"
