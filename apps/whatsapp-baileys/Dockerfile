FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/whatsapp-baileys/package.json ./apps/whatsapp-baileys/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@isp-control/whatsapp-baileys

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/whatsapp-baileys ./apps/whatsapp-baileys
WORKDIR /app/apps/whatsapp-baileys
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/whatsapp-baileys/package.json ./apps/whatsapp-baileys/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace=@isp-control/whatsapp-baileys --omit=dev && npm cache clean --force
COPY --from=build /app/apps/whatsapp-baileys/dist ./apps/whatsapp-baileys/dist
RUN mkdir -p /data/sessions
VOLUME ["/data/sessions"]
WORKDIR /app/apps/whatsapp-baileys
EXPOSE 3101
CMD ["node", "dist/index.js"]
