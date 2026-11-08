#!/usr/bin/env bash
# 10: subscribe to replies, and check the signature of a delivery.
#
# subscribe registers your public https endpoint for messages.received and
# then has GetSales send it one signed test delivery. The answer to the
# register call is the only place the webhook's secret ever appears, so copy
# it into your secret store the moment it prints.
# verify checks one delivery you saved: its X-Webhook-Signature value and its
# raw body, byte for byte, with openssl. The secret comes from
# GETSALES_WEBHOOK_SECRET and never from the command line. When the signature
# holds, it looks up the reply's text, since a delivery names the message by
# sid and carries no text.
# A URL can hold one subscription per workspace, so a second register call
# for it answers 409 duplicate_rejected. Delete the webhook to start over.
# Usage: ./10-subscribe-to-replies.sh subscribe https://example.com/hooks/getsales
#        read -rs GETSALES_WEBHOOK_SECRET && export GETSALES_WEBHOOK_SECRET
#        ./10-subscribe-to-replies.sh verify "t=1762160000,v1=<64 hex characters>" delivery.json
set -euo pipefail
source "$(dirname "$0")/_env.sh"
need_jq

usage() {
  echo "usage: $0 subscribe <public https URL>" >&2
  echo "       $0 verify <X-Webhook-Signature value> <file with the raw body>   (reads GETSALES_WEBHOOK_SECRET)" >&2
  exit 2
}

MODE="${1:-}"
if [ "$MODE" = "subscribe" ]; then
  TARGET_URL="${2:-}"
  [ -n "$TARGET_URL" ] || usage

  # GetSales posts only to https on a host the internet can reach.
  WEBHOOK=$(curl -sS --fail-with-body -X POST "$GETSALES_API/integrations/v1/api/webhooks" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "name": "Replies",
  "target_url": "$TARGET_URL",
  "events": ["messages.received"]
}
JSON
)
  printf '%s' "$WEBHOOK" | jq '{ sid: .item.sid, status: .item.status, events: .item.events, secret: .item.secret }'
  echo "No later read returns the secret. Keep it in your secret store, and give it to verify as GETSALES_WEBHOOK_SECRET." >&2
  WEBHOOK_SID=$(printf '%s' "$WEBHOOK" | jq -r '.item.sid')

  echo "--- one signed test delivery to your endpoint" >&2
  curl -sS --fail-with-body -X POST "$GETSALES_API/integrations/v1/api/webhooks/$WEBHOOK_SID/test" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{ "override_event_type": "messages.received" }
JSON
  echo

elif [ "$MODE" = "verify" ]; then
  HEADER="${2:-}"
  BODY_FILE="${3:-}"
  [ -n "$HEADER" ] && [ -f "$BODY_FILE" ] || usage
  # No secret means nothing can be verified: refuse, never pass.
  SECRET="${GETSALES_WEBHOOK_SECRET:-}"
  if [ -z "$SECRET" ]; then
    echo "GETSALES_WEBHOOK_SECRET is not set. It is the secret the subscribe step printed." >&2
    exit 1
  fi

  T=$(printf '%s' "$HEADER" | tr ',' '\n' | sed -n 's/^ *t=//p' | tail -n 1)
  V1=$(printf '%s' "$HEADER" | tr ',' '\n' | sed -n 's/^ *v1=//p' | tail -n 1 | tr 'A-F' 'a-f')
  if ! printf '%s' "$T" | grep -Eq '^[0-9]{1,12}$' || ! printf '%s' "$V1" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "the header does not read t=<seconds>,v1=<64 hex characters>" >&2
    exit 1
  fi
  # A timestamp more than 5 minutes off this machine's clock, either way, could be a replay.
  NOW=$(date +%s)
  SIGNED_AT=$(( 10#$T ))
  AGE=$(( NOW > SIGNED_AT ? NOW - SIGNED_AT : SIGNED_AT - NOW ))
  if [ "$AGE" -gt 300 ]; then
    echo "stale delivery: signed $AGE seconds away from now" >&2
    exit 1
  fi
  # HMAC-SHA256 of "<t>.<raw body>" keyed with the secret. openssl takes the key
  # as an argument, so it shows in the process list for the moment the hash runs.
  EXPECTED=$( { printf '%s.' "$T"; cat "$BODY_FILE"; } | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.*= //')
  if [ "$EXPECTED" != "$V1" ]; then
    echo "the signature does not match this body and secret" >&2
    exit 1
  fi
  echo "signature ok" >&2

  TYPE=$(jq -r '.type' "$BODY_FILE")
  MESSAGE_SID=$(jq -r '.payload.sid // empty' "$BODY_FILE")
  if [ "$TYPE" = "messages.received" ] && [ -n "$MESSAGE_SID" ]; then
    echo "--- the reply's text" >&2
    curl -sS --fail-with-body -X POST "$GETSALES_API/unibox/v1/api/messages/search" \
      -H "Authorization: Bearer $GETSALES_API_KEY" \
      -H "Content-Type: application/json" \
      --data-binary @- <<JSON
{
  "filter": { "sid": { "eq": "$MESSAGE_SID" } },
  "page_size": 1
}
JSON
    echo
  fi

else
  usage
fi
