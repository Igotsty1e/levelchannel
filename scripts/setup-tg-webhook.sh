#!/bin/bash
# BCS-DEF-4-TG-PROXY (2026-05-21) — register the Telegram webhook
# through the Cloudflare Worker proxy.
#
# Operator usage:
#   curl -s https://raw.githubusercontent.com/Igotsty1e/levelchannel/main/scripts/setup-tg-webhook.sh | bash
#
# Reads from the env file:
#   TELEGRAM_API_BASE_URL          (e.g. https://tg-proxy.<user>.workers.dev)
#   TELEGRAM_BOT_TOKEN
#   TELEGRAM_WEBHOOK_SECRET_TOKEN
#
# No arguments. Echoes Telegram's JSON reply.

set -e

# Operator must pass ENV_FILE explicitly — keeping the path out of the
# public repo (public-surface guard). Example invocation:
#   export ENV_FILE=/path/to/env && curl -s ... | bash
ENV_FILE="${ENV_FILE:?ENV_FILE not set — export ENV_FILE=/path/to/env first}"
# WEBHOOK_URL default = inbound proxy /tg-in on the Worker. This is
# required when the VPS cannot accept Telegram's outgoing webhook POSTs
# directly (RU hosting + Roskomnadzor block). Set WEBHOOK_URL explicitly
# to override (e.g. for dev / non-proxied deployments).
WEBHOOK_URL_DEFAULT_FALLBACK='https://levelchannel.ru/api/telegram/webhook'
WEBHOOK_URL="${WEBHOOK_URL:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERR: $ENV_FILE not found" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${TELEGRAM_API_BASE_URL:-}" ]; then
  echo "ERR: TELEGRAM_API_BASE_URL not set in $ENV_FILE" >&2
  exit 2
fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "ERR: TELEGRAM_BOT_TOKEN not set in $ENV_FILE" >&2
  exit 2
fi
if [ -z "${TELEGRAM_WEBHOOK_SECRET_TOKEN:-}" ]; then
  echo "ERR: TELEGRAM_WEBHOOK_SECRET_TOKEN not set in $ENV_FILE" >&2
  exit 2
fi

# Default WEBHOOK_URL to the Worker /tg-in inbound endpoint. The
# Worker forwards Telegram's POST to the LevelChannel app — this
# is the only path that works on RU hosting where Telegram cannot
# reach the VPS directly.
if [ -z "$WEBHOOK_URL" ]; then
  WEBHOOK_URL="${TELEGRAM_API_BASE_URL%/}/tg-in"
fi

echo "Registering webhook..."
echo "  Proxy:    $TELEGRAM_API_BASE_URL"
echo "  Endpoint: $WEBHOOK_URL"
echo "  Fallback: $WEBHOOK_URL_DEFAULT_FALLBACK (override with WEBHOOK_URL=...)"
echo ""

curl -s -X POST "$TELEGRAM_API_BASE_URL/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$WEBHOOK_URL" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN" \
  -d 'allowed_updates=["message"]'
echo ""
