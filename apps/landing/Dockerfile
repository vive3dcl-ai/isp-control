# Static marketing landing — nginx
FROM nginx:1.27-alpine
RUN apk add --no-cache gettext
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/landing/public /usr/share/nginx/html
COPY apps/landing/docker-entrypoint.sh /docker-entrypoint.d/40-panel-url.sh
RUN chmod +x /docker-entrypoint.d/40-panel-url.sh \
  && PANEL_URL=http://localhost envsubst '${PANEL_URL}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
