FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install OpenCode 2 as the vscode user (installs to ~/.opencode/bin).
USER vscode
RUN curl -fsSL https://opencode.ai/v2/install | bash

# Expose it on the global PATH.
USER root
RUN ln -sf /home/vscode/.opencode/bin/opencode /usr/local/bin/opencode

# cloudflared exposes the pages to a phone over a public url.
# shortcut: amd64 only, switch to $TARGETARCH if you ever build on arm.
RUN curl -fsSL -o /usr/local/bin/cloudflared \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared

# nodejs runs the game logic tests; npm installs the lobby relay deps.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm \
 && rm -rf /var/lib/apt/lists/*
