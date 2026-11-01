# lobby

Minimal WebSocket room relay. The server knows room codes and forwards messages; game
logic stays in each browser.

## Run

    npm install                    # once; the devcontainer runs this itself
    PORT=8080 node server.mjs      # http://localhost:8080
    node --test                    # relay + HTTP/WS tests

Docker (listens on `:8080`):

    docker build -t minigames-lobby .
    docker run -d -p 8080:8080 --restart unless-stopped minigames-lobby

Reverse proxy, TLS, hardening and operating notes: [HOSTING.md](HOSTING.md).

Behind a reverse proxy the WebSocket upgrade must pass through (nginx):

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;   # > idle timeout, otherwise the proxy cuts quiet rooms
    }

## Config (env)

| variable | default | meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `HASHCASH_BITS` | `19` | work required per room creation (~1s on a laptop) |
| `ROOM_TTL_MIN` | `120` | hard limit per room, in minutes |
| `IDLE_TTL_MIN` | `10` | delete a room after this long without a relayed message |
| `RATE_KBPS` | `5` | send limit per participant, in KiB/s (burst = 1 s) |
| `SWEEP_MS` | `30000` | timeout check interval |
| `ALLOWED_ORIGINS` | lobby + game + localhost origins | comma-separated browser origins allowed on the WebSocket upgrade |

The integration guide is served at `/guide.html`.

## Flow

1. `GET /challenge` → `{challenge, bits}`. Browser solves `sha256("<challenge>:<n>")` with
   `bits` leading zero bits, then sends `{t:"create", proof, name, returnUrl, maxPlayers}`.
   Server verifies the proof, marks the challenge used and generates a four-word room id
   from the EFF short wordlist (e.g. `acid-acorn-acre-acts`). Room state 0 → 1.
2. State 1 (`open`): participants join via `?room=<id>` (name prompt, token in
   `sessionStorage` for reloads). Everyone sees the peer list with online/offline state; an
   inactive tab keeps its WebSocket, only a closed tab marks the player offline. Only the host
   can send `{t:"start"}` or `{t:"kick", id}` to remove a player.
3. State 2 (`active`): no new participants, existing tokens may rejoin. `{t:"msg", data}`
   is forwarded to the room's other members. The server never inspects `data`.
4. A `?return=<game-url>` and `?maxPlayers=<n>` passed to the lobby are stored on the room at
   create and sent in every `joined`. When the host sends `{t:"start"}`, each lobby client
   opens that URL with `?room=<id>` plus `#token=...&name=...&lobby=<ws-url>`, so the game can
   join the same room. Only origins in `ALLOWED_RETURN_ORIGINS`
   (`public/return-url.js`) are accepted. The per-room player limit is clamped to 1…12.
5. State 3 (`timeout`): after `ROOM_TTL_MIN` or `IDLE_TTL_MIN` the room is deleted and
   clients get `{t:"closed", reason}`.

Rate limiting is a token bucket per participant: messages over `RATE_KBPS` are dropped
and answered with `{t:"error", code:"rate-limit"}` (at most one warning per second).

shortcut: fairness and cheating are not enforced — any participant can send anything,
and the host is just "whoever created the room". Add server-side rule checks only if you
ever open rooms to strangers.
