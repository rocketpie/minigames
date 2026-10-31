# Hosting the lobby in a container

The image serves HTTP and WebSocket on one port and keeps all rooms in RAM. No volume, no database, no env secrets.

## Build and run

    docker build -t minigames-lobby .
    docker run -d --name lobby \
      -p 127.0.0.1:8080:8080 \
      --restart unless-stopped \
      minigames-lobby

`127.0.0.1` keeps the port off the internet; the reverse proxy below publishes it. The image
binds 8080 as the `node` user and needs no file capabilities, so `--cap-drop ALL` and
`no-new-privileges` are fine (they are what the compose file uses).

### Shipping and Updates

- run `deploy.ps1` on the host 


## Reverse proxy + TLS

WebSocket needs the upgrade headers, and the proxy's read timeout must outlive the idle
timeout (`IDLE_TTL_MIN`, default 10 min):

**Caddy** – handles TLS and WebSocket by itself:

    lobby.example.com {
        reverse_proxy 127.0.0.1:8080
    }

The browser picks `wss://` automatically when the page is served over HTTPS, so the join link
and QR code work unchanged. The relay ignores client IPs, so no `X-Forwarded-*` setup is
needed.

## Config

All values are read from the environment at start; the table lives in [README.md](README.md#config-env).
Worth tuning on a slow phone: `HASHCASH_BITS=18` (about 4× faster room creation, less spam protection).

## Operating notes

- **Health**: `GET /healthz` → `200 ok`; the image already has a healthcheck that honours `PORT`.
- **Logs**: `docker logs -f lobby`. The server logs only startup and errors; message contents
  and room ids are never logged.
- **Limits**: a room is ~a few KiB; the process needs well under 128 MB. Cap it anyway:
  `--memory 128m --pids-limit 64`.
- **Firewall**: expose only the proxy port; keep `127.0.0.1:8080` closed.

## Troubleshooting

| symptom | cause |
|---|---|
| join page loads, "Verbindung getrennt" | proxy does not forward `Upgrade`/`Connection`, or buffers the response |
| socket closes after ~10 min of silence | proxy `proxy_read_timeout` shorter than `IDLE_TTL_MIN` |
| "Hashcash ungültig" | client took longer than 5 min to solve the challenge; retry |
