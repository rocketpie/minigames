#!/bin/bash
# Serves games/ at /games/ and the lobby at /lobby/ through one public https url.
# Uses a lobby already running on :8080 (e.g. the container), otherwise starts the dev server.
command -v cloudflared >/dev/null || { echo "cloudflared not installed" >&2; exit 1; }
cd "$(dirname "$0")"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null; }
trap cleanup EXIT

if ! node -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
  node lobby/server.mjs &
  pids+=($!)
fi

node serve.mjs &
pids+=($!)
cloudflared tunnel --url http://localhost:8000
