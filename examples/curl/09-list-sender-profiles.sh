#!/usr/bin/env bash
# 09: list your sender profiles and the channels each one holds.
#
# A sender profile is the identity your team sends as, with its LinkedIn account and its mailboxes.
# linkedin_status is null while the profile has no LinkedIn account, and
# mailboxes[] lists each mailbox with its address, its status and whether it
# is the primary one.
# There is no single-read call: to read one, filter by "sid": { "eq": "ub_sp_..." }.
# A workflow names the sender profiles it uses by these ub_sp_ sids.
# Usage: ./09-list-sender-profiles.sh
set -euo pipefail
source "$(dirname "$0")/_env.sh"

curl -sS --fail-with-body -X POST "$GETSALES_API/unibox/v1/api/sender-profiles/search" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "sort": { "field": "name", "direction": "asc" },
  "page_size": 100
}
JSON
echo
