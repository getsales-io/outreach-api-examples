#!/usr/bin/env bash
# 07: list your workflows, the multichannel sequences people move through,
# with their status and how many people each one holds.
#
# Archived workflows are left out with a status filter. A workflow takes new
# people only once it has a published version: published_version_sid is null
# until the first publish. include records_counts adds the per-workflow
# enrollment counts (total_count, and groups.status by journey state).
# Usage: ./07-list-workflows.sh [cursor]
set -euo pipefail
source "$(dirname "$0")/_env.sh"
CURSOR_JSON="$(json_or_null "${1:-}")"

curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/workflows/search" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "filter": { "status": { "ne": "archived" } },
  "include": ["records_counts"],
  "sort": { "field": "updated_at", "direction": "desc" },
  "page_size": 50,
  "cursor": $CURSOR_JSON
}
JSON
echo

# For the page after this one, run the script again with the answer's
# pagination.next_cursor as its argument, unchanged. A null cursor means the
# list has no more pages.
