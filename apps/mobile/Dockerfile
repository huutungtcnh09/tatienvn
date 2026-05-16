# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
WORKDIR /usr/share/nginx/html
COPY --from=builder /app/dist .
COPY --from=builder /app/dist/assets ./assets
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
