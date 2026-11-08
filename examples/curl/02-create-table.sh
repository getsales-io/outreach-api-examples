#!/usr/bin/env bash
# 02: create a table, the workspace's container for a list of people and
# companies. The table comes with a default view per tab, and both view sids
# are in the answer.
#
# Creating is idempotent on the name: a second call with the same name returns
# the existing table with already_exists true. config.auto_run false keeps paid
# columns from running on rows as they land. You start runs yourself (see 06).
# Usage: ./02-create-table.sh ["Table name"] ["Description"]
set -euo pipefail
source "$(dirname "$0")/_env.sh"
NAME="${1:-Agencies for the Q4 campaign}"
DESCRIPTION="${2:-Created from the outreach API examples}"

curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/playtables" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "name": "$NAME",
  "description": "$DESCRIPTION",
  "config": { "auto_run": false }
}
JSON
echo

# Keep item.sid (pt_tb_...): the next examples take it.
