# Production web — Vite build + nginx
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/whatsapp-baileys/package.json ./apps/whatsapp-baileys/
RUN npm ci --workspace=@isp-control/web
COPY apps/web ./apps/web
WORKDIR /app/apps/web
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# vite build only — tsc gate se corre en CI/local; no bloquea imagen prod
RUN npx vite build

FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
