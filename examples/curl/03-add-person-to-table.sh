#!/usr/bin/env bash
# 03: add a person to a table, and get the existing row back instead of a 409
# when the workspace already has them.
#
# Duplicates are found across the whole workspace by the emails and the
# LinkedIn identifiers: ln_member_id, ln_id, sn_id, and ln_nickname, the
# LinkedIn public ID. With on_duplicate "skip" the existing row comes back with
# already_exists true, wherever it lives ("move" would re-home it into this
# table instead). Without on_duplicate, an email or LinkedIn id match answers
# 409 duplicate_rejected, and a match on the public ID alone adds the row
# flagged as a duplicate.
# A person stays in one table at a time: item.playtable_sid says which.
# Pass - for a value you do not have.
# Usage: ./03-add-person-to-table.sh pt_tb_XXXXXXXXXXXX jane.cooper@example.com ["Jane Cooper"] [ln_nickname]
set -euo pipefail
source "$(dirname "$0")/_env.sh"

if [ $# -lt 2 ]; then
  echo "usage: $0 <playtable_sid> <work_email or -> [full_name] [ln_nickname]" >&2
  exit 2
fi
PLAYTABLE_SID="$1"
value() { if [ "${1:-}" = "-" ]; then echo ""; else echo "${1:-}"; fi; }
WORK_EMAIL="$(value "$2")"
FULL_NAME="$(value "${3:-}")"
LN_NICKNAME="$(value "${4:-}")"
WORK_EMAIL_JSON="$(json_or_null "$WORK_EMAIL")"
FULL_NAME_JSON="$(json_or_null "$FULL_NAME")"
LN_NICKNAME_JSON="$(json_or_null "$LN_NICKNAME")"

curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/people" \
  -H "Authorization: Bearer $GETSALES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "playtable_sid": "$PLAYTABLE_SID",
  "work_email": $WORK_EMAIL_JSON,
  "full_name": $FULL_NAME_JSON,
  "ln_nickname": $LN_NICKNAME_JSON,
  "on_duplicate": "skip"
}
JSON
echo

# item.status reads ok, no_contact_data (no identity given), duplicate or
# stoplisted. A person with no identity at all is still created, as
# no_contact_data, and an enrichment column can fill them in later.
