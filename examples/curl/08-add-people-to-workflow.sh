#!/usr/bin/env bash
# 08: add people to a workflow. Anyone the workflow already holds stays as
# they are, so a second run of the script, or a retry after a lost answer,
# starts nobody over.
#
# add_workflow_people is the one way into a workflow. The people enter
# through the workflow's manual source, and the call makes that source when
# the workflow has none, so a key that may act on workflows is enough. A
# person the workflow holds already is left as they are, a finished journey
# included, and counted in skipped_enrolled_count. To run them again on
# purpose, add "restart" to the body: "from_start" runs them from the first
# step, "from_current" from the step they are on.
# The workflow needs a published version (409 invalid_transition) and must
# not be archived (409 conflict). Every person sid must exist (find them with
# 04): one unknown sid rejects the whole call with 422 relation_not_found,
# and nobody is added.
# Usage: ./08-add-people-to-workflow.sh wf_wf_XXXXXXXXXXXX cr_pp_XXXXXXXXXXXX [more cr_pp_ sids, up to 500]
set -euo pipefail
source "$(dirname "$0")/_env.sh"
need_jq

if [ $# -lt 2 ]; then
  echo "usage: $0 <workflow_sid> <person_sid> [more person sids]" >&2
  exit 2
fi
WORKFLOW_SID="$1"
shift
# The person sids as a JSON array, each one once, in the order given.
PEOPLE_JSON=$(printf '%s\n' "$@" | awk '!seen[$0]++' | jq -R . | jq -sc .)
if [ "$(printf '%s' "$PEOPLE_JSON" | jq 'length')" -gt 500 ]; then
  echo "at most 500 people per call" >&2
  exit 2
fi

curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/workflows/$WORKFLOW_SID/add-people" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{ "people_sids": $PEOPLE_JSON }
JSON
echo

# result counts what this call did: entered_count for new journeys,
# skipped_enrolled_count for people the workflow held already, and the
# blocked counters (blocked_stoplisted_count for people on the stoplist, for
# instance). source_created is true when this call made the manual source,
# and item is that source.
