# Every script in this folder sources this file. It stops early when no key is
# set, and it sets GETSALES_API to the host the requests go to.
#
# The host lives in one place, the API_HOST line of examples/typescript/client.ts,
# and this file reads it from there, so the two halves always call the same
# host. Set GETSALES_API_HOST to send both somewhere else, such as a local mock.

: "${GETSALES_API_KEY:?is not set. Create a key in the app (Settings, API keys) and export it, as the README shows}"

_examples_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GETSALES_API="${GETSALES_API_HOST:-$(sed -n 's/^export const API_HOST = "\([^"]*\)";$/\1/p' "$_examples_dir/typescript/client.ts")}"
GETSALES_API="${GETSALES_API%/}"
if [ -z "$GETSALES_API" ]; then
  echo "no API_HOST line found in $_examples_dir/typescript/client.ts" >&2
  exit 1
fi

# Writes a JSON string for a non-empty value and null for an empty one. The
# value lands in the JSON body unescaped, so it must not contain double quotes.
json_or_null() {
  if [ -n "${1:-}" ]; then printf '"%s"' "$1"; else printf 'null'; fi
}

# Lowercases an address and drops the spaces around it. People search matches a
# work email as a lowercased term, so an address is normalized before it is used
# as a filter.
normalize_email() {
  printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# The scripts with several steps read values out of the answers with jq.
need_jq() {
  command -v jq >/dev/null 2>&1 || { echo "this script needs jq: https://jqlang.org" >&2; exit 1; }
}
