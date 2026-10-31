# Hosting the lobby in a container

The image serves HTTP and WebSocket on one port and keeps all rooms in RAM. No volume, no
database, no env secrets. One instance only – see [Scaling](#scaling).

## Build and run

    docker build -t minigames-lobby .
    docker run -d --name lobby \
      -p 127.0.0.1:8080:8080 \
      -e PORT=8080 \
      --restart unless-stopped \
      minigames-lobby

`127.0.0.1` keeps the port off the internet; the reverse proxy below publishes it. Without a
proxy use the image default instead: `-p 8080:80` (the image can bind :80 as non-root).

Or with compose (`lobby/docker-compose.yml`):

```yaml
services:
  lobby:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      PORT: "8080"
      HASHCASH_BITS: "20"
      RATE_KBPS: "5"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

    docker compose up -d --build

No `/tmp`, no volume, nothing to back up: `read_only` is safe because the relay never writes
to disk. Rooms vanish on restart, so deploy when nobody is playing.

## Reverse proxy + TLS

WebSocket needs the upgrade headers, and the proxy's read timeout must outlive the idle
timeout (`IDLE_TTL_MIN`, default 10 min):

**nginx**

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    server_name lobby.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
    }

    # TLS via certbot / your existing certs
}
```

**Caddy** – handles TLS and WebSocket by itself:

    lobby.example.com {
        reverse_proxy 127.0.0.1:8080
    }

The browser picks `wss://` automatically when the page is served over HTTPS, so the join link
and QR code work unchanged. The relay ignores client IPs, so no `X-Forwarded-*` setup is
needed.

## Config

All values are read from the environment at start; the table lives in [README.md](README.md#config-env).
Worth tuning on a slow phone: `HASHCASH_BITS=18` (about 4× faster room creation, less spam
protection).

## Operating notes

- **Health**: `GET /healthz` → `200 ok`; the image already has a healthcheck that honours `PORT`.
- **Logs**: `docker logs -f lobby`. The server logs only startup and errors; message contents
  and room ids are never logged.
- **Limits**: a room is ~a few KiB; the process needs well under 128 MB. Cap it anyway:
  `--memory 128m --pids-limit 64`.
- **Updates**: `docker compose up -d --build` (or rebuild + `docker rm -f lobby` + run).
- **Firewall**: expose only the proxy port; keep `127.0.0.1:8080` closed.

## Scaling

Not supported: rooms exist only in the process memory of one container. A second replica
would need shared state and sticky WebSocket sessions, which this PoC deliberately does not
have. Vertical limits are fine – a few hundred idle rooms are not a problem. If you ever need
more, put rooms in a shared store or split rooms by instance with a coordination layer.

## Troubleshooting

| symptom | cause |
|---|---|
| join page loads, "Verbindung getrennt" | proxy does not forward `Upgrade`/`Connection`, or buffers the response |
| socket closes after ~10 min of silence | proxy `proxy_read_timeout` shorter than `IDLE_TTL_MIN` |
| room gone after a restart | expected, state is in memory |
| "Hashcash ungültig" | client took longer than 5 min to solve the challenge; retry |
| 502 after deploy | container bound `:80` but was published on `:8080`, set `PORT` to match |
