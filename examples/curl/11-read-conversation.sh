#!/usr/bin/env bash
# 11: read a conversation from the unified inbox: the thread, who is in it,
# and its messages, on email and LinkedIn alike.
#
# The thread read returns its state (needs_you, agent, waiting, stalled, later,
# done), its channels and, with include participants, everyone in it.
# Messages come from the message search, newest first. For the page before the
# oldest message you hold, add "created_at": { "lt": "<its created_at>" } to
# the filter. author says who wrote each one: contact, user or agent.
# Usage: ./11-read-conversation.sh ub_cv_XXXXXXXXXXXX
set -euo pipefail
source "$(dirname "$0")/_env.sh"

CONVERSATION_SID="${1:-}"
if [ -z "$CONVERSATION_SID" ]; then
  echo "usage: $0 <conversation_sid>" >&2
  exit 2
fi

echo "--- the thread" >&2
curl -sS --fail-with-body --globoff -X GET "$GETSALES_API/unibox/v1/api/conversations/$CONVERSATION_SID?include[]=participants" \
  -H "Authorization: Bearer $GETSALES_API_KEY"
echo

echo "--- its newest messages" >&2
curl -sS --fail-with-body -X POST "$GETSALES_API/unibox/v1/api/messages/search" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "filter": { "conversation_sid": { "eq": "$CONVERSATION_SID" } },
  "sort": { "field": "created_at", "direction": "desc" },
  "page_size": 20
}
JSON
echo
