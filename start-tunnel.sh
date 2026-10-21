#!/bin/bash
# serves games/ on 8000 and exposes it as a public https url via cloudflare tunnel
command -v cloudflared >/dev/null || { echo "cloudflared not installed" >&2; exit 1; }
cd "$(dirname "$0")"
node serve.mjs &
server=$!
trap 'kill $server' EXIT
cloudflared tunnel --url http://localhost:8000
