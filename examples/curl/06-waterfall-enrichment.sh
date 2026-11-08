#!/usr/bin/env bash
# 06: add a waterfall enrichment column that finds work emails, price it with
# estimate_credits, then run it with a budget.
#
# The column's steps run in order and stop at the first address found: the
# address the row already has (free as a step), then every email finder in
# the provider catalog. A verifier from the catalog checks each address before
# it wins, the row's own one too unless its email_status is already ok, and a
# rejected address sends the chain on to the next finder.
# Creating the column spends nothing. auto_run stays false, so the run below,
# capped by max_budget, is the only spending. If you switch auto_run on later,
# rows that land run outside any run's budget: daily_credit_limit on the
# column is the cap then.
# The estimate prices the run before it starts, over the same rows and the
# same cells, and answers min, expected and max in credits. Set max_budget
# from max, never from expected: expected is the likely cost, and a budget
# under max can stop the run before the last row (reason budget_exhausted).
# Usage: ./06-waterfall-enrichment.sh pt_tb_XXXXXXXXXXXX        estimate only
#        ./06-waterfall-enrichment.sh pt_tb_XXXXXXXXXXXX 120    run it, max_budget 120 credits
set -euo pipefail
source "$(dirname "$0")/_env.sh"
need_jq

PLAYTABLE_SID="${1:-}"
BUDGET="${2:-}"
if [ -z "$PLAYTABLE_SID" ]; then
  echo "usage: $0 <playtable_sid> [max_budget_in_credits]" >&2
  exit 2
fi
if [ -n "$BUDGET" ] && ! printf '%s' "$BUDGET" | grep -Eq '^[0-9]+([.][0-9]+)?$'; then
  echo "max_budget must be a number of credits, got: $BUDGET" >&2
  exit 2
fi

echo "--- 1. email finders and verifiers from the provider catalog" >&2
CATALOG=$(curl -sS --fail-with-body -X GET "$GETSALES_API/integrations/v1/api/provider-catalog" \
  -H "Authorization: Bearer $GETSALES_API_KEY")

# The row's own address first, then every finder, each with the same inputs
# filled per row from the table: each finder reads the inputs it serves.
STEPS=$(printf '%s' "$CATALOG" | jq -c '
  [{ tool_sid: "row:people.work_email", params: {} }] +
  [ .result.entries[]
    | select(.operation == "email.find" and .platform_key)
    | { tool_sid: ("in:" + .provider + ".email.find"),
        params: { full_name: "{{people.full_name}}", company_name: "{{company.name}}", domain: "{{company.domain}}" } } ]')
# The cheapest verifier, or none.
VERIFY=$(printf '%s' "$CATALOG" | jq -c '
  [ .result.entries[] | select(.operation == "email.verify" and .platform_key) ]
  | sort_by(.price_expected) | first
  | if . == null then null else { tool_sid: ("in:" + .provider + ".email.verify"), params: {} } end')
if [ "$(printf '%s' "$STEPS" | jq 'length')" -lt 2 ]; then
  echo "the provider catalog lists no email finder right now" >&2
  exit 1
fi

echo "--- 2. the table's people view, the run's scope" >&2
TABLE=$(curl -sS --fail-with-body -X GET "$GETSALES_API/playtables/v1/api/playtables/$PLAYTABLE_SID" \
  -H "Authorization: Bearer $GETSALES_API_KEY")
VIEW_SID=$(printf '%s' "$TABLE" | jq -r '.item.people_default_view_sid')

echo "--- 3. the column" >&2
# Idempotent on the slug: a second call returns the existing column.
FIELD=$(curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/playtable-fields" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "playtable_sid": "$PLAYTABLE_SID",
  "object_type": "people",
  "type": "action_waterfall",
  "name": "Work email finder",
  "slug": "work_email_finder",
  "payload": {
    "steps": $STEPS,
    "stop_on_first": true,
    "output_mapping": [{ "path": "\$.email", "target": "people.work_email" }],
    "verify": $VERIFY,
    "accept_catch_all": true
  },
  "config": {
    "auto_run": false,
    "run_condition": null,
    "nl_condition": null,
    "daily_credit_limit": null,
    "preset_sid": null
  },
  "add_to_default_view": true
}
JSON
)
FIELD_SID=$(printf '%s' "$FIELD" | jq -r '.item.sid')
FIELD_TYPE=$(printf '%s' "$FIELD" | jq -r '.item.type')
if [ "$FIELD_TYPE" != "action_waterfall" ]; then
  echo "the slug work_email_finder already belongs to a $FIELD_TYPE column of this table" >&2
  exit 1
fi
printf '%s' "$FIELD" | jq -c '{ field: .item.sid, name: .item.name, already_exists }'

echo "--- 4. the estimate: what the run would cost, over its rows and its cells" >&2
# rows is the run's scope below, and cells the run's params.cells: the
# estimate prices the cells of the view that have not run yet.
ESTIMATE=$(curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/playtable-fields/estimate-credits" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "rows": { "view_sid": "$VIEW_SID" },
  "actions": [
    { "type": "column", "field_sid": "$FIELD_SID", "cells": "not_run" }
  ]
}
JSON
)
printf '%s' "$ESTIMATE" | jq -c '.result | { rows_to_run: .actions[0].rows, rows_matched: .basis.rows.matched, min, expected, max, currency }'
ESTIMATE_MAX=$(printf '%s' "$ESTIMATE" | jq -r '.result.max')

if [ -z "$BUDGET" ]; then
  echo "Nothing ran. To run it, pass a budget in credits, set from the estimate's max:" >&2
  echo "  $0 $PLAYTABLE_SID $ESTIMATE_MAX" >&2
  exit 0
fi
if awk -v b="$BUDGET" -v m="$ESTIMATE_MAX" 'BEGIN { exit !(b < m) }'; then
  echo "note: a budget under the estimate's max ($ESTIMATE_MAX) can stop the run before the last row (reason budget_exhausted)" >&2
fi

echo "--- 5. the run, capped at $BUDGET credits" >&2
RUN=$(curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/playtable-runs" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "playtable_sid": "$PLAYTABLE_SID",
  "object_type": "people",
  "type": "enrich",
  "field_sids": ["$FIELD_SID"],
  "scope": { "view_sid": "$VIEW_SID" },
  "params": { "cells": "not_run" },
  "max_budget": $BUDGET
}
JSON
)
RUN_SID=$(printf '%s' "$RUN" | jq -r '.item.sid')
echo "run $RUN_SID" >&2

echo "--- 6. progress, every 5 seconds until it ends" >&2
while true; do
  PROGRESS=$(curl -sS --fail-with-body --globoff -X GET "$GETSALES_API/playtables/v1/api/playtable-runs/$RUN_SID?include[]=progress" \
    -H "Authorization: Bearer $GETSALES_API_KEY")
  printf '%s' "$PROGRESS" | jq -c '.included.progress | { state, processed_jobs, total_jobs, failed_jobs, spent_credits }'
  STATE=$(printf '%s' "$PROGRESS" | jq -r '.included.progress.state')
  if [ "$STATE" = "finished" ] || [ "$STATE" = "cancelled" ]; then
    break
  fi
  sleep 5
done
