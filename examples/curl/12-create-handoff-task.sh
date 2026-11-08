#!/usr/bin/env bash
# 12: hand a conversation to a teammate with a task.
#
# A task anchored to a thread shows on the thread, and a task that is undated
# or due today turns the thread to needs_you at once. Put in body what the
# teammate needs to act without rereading the thread. Your AI SDR opens the
# same kind of task when it hands a thread to a person.
# With a teammate's email, the script looks up their member record and assigns
# the task to them (reading members takes a key that may view team members).
# The address is lowercased and trimmed before it goes into the filter.
# Without one, the task stays unassigned. Each run of the script makes a new task.
# Usage: ./12-create-handoff-task.sh ub_cv_XXXXXXXXXXXX [teammate@example.com] ["Task title"]
set -euo pipefail
source "$(dirname "$0")/_env.sh"
need_jq

CONVERSATION_SID="${1:-}"
TEAMMATE_EMAIL="$(normalize_email "${2:-}")"
TITLE="${3:-Reply needs a person: they asked for a call}"
if [ -z "$CONVERSATION_SID" ]; then
  echo "usage: $0 <conversation_sid> [teammate_email] [title]" >&2
  exit 2
fi

ASSIGNEE_JSON=null
if [ -n "$TEAMMATE_EMAIL" ]; then
  echo "--- the teammate's member record" >&2
  MEMBERS=$(curl -sS --fail-with-body -X POST "$GETSALES_API/id/v1/api/team-members/search" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "filter": {
    "email": { "eq": "$TEAMMATE_EMAIL" },
    "status": { "eq": "active" }
  },
  "page_size": 1
}
JSON
)
  USER_SID=$(printf '%s' "$MEMBERS" | jq -r '.items[0].item.user_sid // empty')
  if [ -z "$USER_SID" ]; then
    echo "no active member with the email $TEAMMATE_EMAIL" >&2
    exit 1
  fi
  ASSIGNEE_JSON="\"$USER_SID\""
fi

echo "--- the task" >&2
curl -sS --fail-with-body -X POST "$GETSALES_API/unibox/v1/api/tasks" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "title": "$TITLE",
  "body": "They replied asking for a short call next week. Offer two times and send the meeting link.",
  "conversation_sid": "$CONVERSATION_SID",
  "assignee_user_sid": $ASSIGNEE_JSON
}
JSON
echo

# due_at sets a deadline (ISO 8601 UTC). An open task expires a month after
# it is created unless you set expires_at, or null for never.
