# Lobby relay, listens on :80 as an unprivileged user.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY relay.mjs server.mjs ./
COPY public ./public

# allow the unprivileged node user to bind port 80
RUN apk add --no-cache libcap && setcap cap_net_bind_service=+ep /usr/local/bin/node

ENV NODE_ENV=production PORT=80
USER node
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
