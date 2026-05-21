#!/bin/bash
# BCS-DEF-4-TG-PROXY (2026-05-21) — register the Telegram webhook
# through the Cloudflare Worker proxy.
#
# Operator usage:
#   curl -s https://raw.githubusercontent.com/Igotsty1e/levelchannel/main/scripts/setup-tg-webhook.sh | bash
#
# Reads from /etc/levelchannel.env:
#   TELEGRAM_API_BASE_URL          (e.g. https://tg-proxy.<user>.workers.dev)
#   TELEGRAM_BOT_TOKEN
#   TELEGRAM_WEBHOOK_SECRET_TOKEN
#
# No arguments. Echoes Telegram's JSON reply.

set -e

ENV_FILE="${ENV_FILE:-/etc/levelchannel.env}"
WEBHOOK_URL="${WEBHOOK_URL:-https://levelchannel.ru/api/telegram/webhook}"

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

echo "Registering webhook..."
echo "  Proxy:    $TELEGRAM_API_BASE_URL"
echo "  Endpoint: $WEBHOOK_URL"
echo ""

curl -s -X POST "$TELEGRAM_API_BASE_URL/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$WEBHOOK_URL" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN" \
  -d 'allowed_updates=["message"]'
echo ""
