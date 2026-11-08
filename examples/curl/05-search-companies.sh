#!/usr/bin/env bash
# 05: search the companies in your workspace, by domain or by name.
#
# A domain is an exact filter on the lowercased apex domain. Anything else goes
# to q, free text over the name, domain and website. include people_counts adds
# how many people of each company the workspace holds.
# To stay inside one table, add "playtable_sids": { "in": ["pt_tb_..."] } to the filter.
# Usage: ./05-search-companies.sh example.com
#        ./05-search-companies.sh "Example Agency"
set -euo pipefail
source "$(dirname "$0")/_env.sh"

QUERY="${1:-}"
if [ -z "$QUERY" ]; then
  echo "usage: $0 <domain | company name>" >&2
  exit 2
fi
LOWER="$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]')"

if printf '%s' "$LOWER" | grep -Eq '^[a-z0-9-]+(\.[a-z0-9-]+)+$'; then
  curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/companies/search" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "filter": { "domain": { "eq": "$LOWER" } },
  "include": ["people_counts"],
  "page_size": 10
}
JSON
else
  curl -sS --fail-with-body -X POST "$GETSALES_API/playtables/v1/api/companies/search" \
    -H "Authorization: Bearer $GETSALES_API_KEY" \
    -H "Content-Type: application/json" \
    --data-binary @- <<JSON
{
  "filter": { "q": "$QUERY" },
  "include": ["people_counts"],
  "page_size": 10
}
JSON
fi
echo
