#!/bin/sh
set -eu

url="${REGISTRY_API_URL:-}"
printable="$(printf '%s' "$url" | LC_ALL=C tr -cd '\040-\176')"
if [ "$printable" != "$url" ]; then
  echo "REGISTRY_API_URL must contain only printable ASCII characters; encode non-ASCII URL characters." >&2
  exit 1
fi
escaped="$(printf '%s' "$url" | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf 'window.__MODAN_CONFIG__ = {"registryApiUrl":"%s"};\n' "$escaped" > /usr/share/nginx/html/runtime-config.js
