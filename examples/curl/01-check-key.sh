#!/usr/bin/env bash
# 01: check that your key works and see which workspace it acts in.
#
# A table search with page_size 0 returns counts and no rows, which makes it
# the cheapest call that proves a key. In the answer, meta.team_sid is the
# workspace and meta.actor_type reads "api_key".
# The current-user call, GET /id/v1/api/users/current, is no use for this: it
# looks the caller up as a person, a key's actor is the key's own id_ak_ sid,
# and so it answers 422 validation_failed with
# error.field_errors.sid[0].rule "invalid_id_type".
# Usage: ./01-check-key.sh
set -euo pipefail
source "$(dirname "$0")/_env.sh"

curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/playtables/search" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{ "page_size": 0 }
JSON
echo
