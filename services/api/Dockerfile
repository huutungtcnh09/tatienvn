FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_PRODUCTION=false
ENV NPM_CONFIG_FETCH_TIMEOUT=120000
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=30000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000
ENV NPM_CONFIG_FETCH_RETRIES=10

COPY package.json package-lock.json ./
COPY services/api/package.json services/api/package.json
COPY apps/head-office/package.json apps/head-office/package.json
COPY apps/store-pos/package.json apps/store-pos/package.json
COPY apps/corporate-web/package.json apps/corporate-web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci

COPY services/api services/api

WORKDIR /app/services/api
RUN npx prisma generate --config prisma.config.ts
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000
CMD ["sh", "docker-entrypoint.sh"]