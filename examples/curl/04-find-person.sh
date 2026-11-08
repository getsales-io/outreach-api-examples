#!/usr/bin/env bash
# 04: find a person in the workspace, by work email or by free text.
#
# An email becomes an exact filter on work_email. People search matches that
# field as a lowercased term, so the address is lowercased and trimmed first.
# Anything else goes to q, free text over the name, the company name, the
# emails and the LinkedIn public ID. Each row's context carries the name, the
# role and the company the person is shown with.
# Other exact filters: ln_member_id, ln_id, sn_id, ln_nickname, playtable_sid.
# Usage: ./04-find-person.sh jane.cooper@example.com
#        ./04-find-person.sh "Jane Cooper"
set -euo pipefail
source "$(dirname "$0")/_env.sh"

QUERY="$(printf '%s' "${1:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$QUERY" ]; then
  echo "usage: $0 <work_email | name or other text>" >&2
  exit 2
fi

if [[ "$QUERY" == *@* ]]; then
  EMAIL="$(normalize_email "$QUERY")"
  curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/people/search" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "filter": { "work_email": { "eq": "$EMAIL" } },
  "page_size": 10
}
JSON
else
  curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/people/search" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "filter": { "q": "$QUERY" },
  "page_size": 10
}
JSON
fi
echo

# Each row is items[].item. Search reads an index that trails a fresh write by
# a few seconds.
