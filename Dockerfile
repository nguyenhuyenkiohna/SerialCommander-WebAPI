# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends netcat-openbsd mosquitto docker.io \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=2999 \
    HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chmod +x docker-entrypoint.sh \
  && mkdir -p uploads

EXPOSE 2999

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:2999/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
