FROM node:20-alpine AS builder

WORKDIR /app
ENV NODE_ENV=development
ENV PATH=/app/node_modules/.bin:$PATH
ENV NPM_CONFIG_PRODUCTION=false
ENV NPM_CONFIG_FETCH_TIMEOUT=120000
ENV NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=30000
ENV NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000
ENV NPM_CONFIG_FETCH_RETRIES=10

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm cache clean --force && npm cache verify

COPY package.json package-lock.json ./
COPY apps/store-pos/package.json apps/store-pos/package.json
COPY apps/head-office/package.json apps/head-office/package.json
COPY apps/corporate-web/package.json apps/corporate-web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY services/api/package.json services/api/package.json
COPY shared shared
RUN npm ci
RUN npm install -g vite@5.4.21

COPY apps/store-pos apps/store-pos
WORKDIR /app/apps/store-pos
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/store-pos/dist /usr/share/nginx/html
EXPOSE 80
