# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

ENV NODE_ENV=development
ENV PATH=/app/node_modules/.bin:$PATH
ENV NPM_CONFIG_PRODUCTION=false

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY package.json package-lock.json ./
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/head-office/package.json apps/head-office/package.json
COPY apps/store-pos/package.json apps/store-pos/package.json
COPY apps/corporate-web/package.json apps/corporate-web/package.json
COPY services/api/package.json services/api/package.json
COPY shared shared
RUN npm ci

COPY apps/mobile apps/mobile
WORKDIR /app/apps/mobile
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/apps/mobile/dist .
COPY --from=builder /app/apps/mobile/dist/assets ./assets
COPY apps/mobile/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
