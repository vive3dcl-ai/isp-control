# Production API — multi-stage build
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/whatsapp-baileys/package.json ./apps/whatsapp-baileys/
RUN npm ci --workspace=@isp-control/api

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache python3 make g++ postgresql-client iproute2 su-exec
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/whatsapp-baileys/package.json ./apps/whatsapp-baileys/
RUN npm ci --workspace=@isp-control/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
COPY deploy/vpn-routes/install-routes.sh /vpn-routes/install-routes.sh
RUN chmod +x /docker-entrypoint.sh /vpn-routes/install-routes.sh
WORKDIR /app/apps/api
EXPOSE 3000
# Entrypoint: rutas VPN (root) → su-exec node
ENTRYPOINT ["/docker-entrypoint.sh"]
