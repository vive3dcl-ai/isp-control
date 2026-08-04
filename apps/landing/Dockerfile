# Static marketing landing — nginx
FROM nginx:1.30.4-alpine3.24
RUN apk add --no-cache gettext
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/landing/public /usr/share/nginx/html
COPY apps/landing/docker-entrypoint.sh /docker-entrypoint.d/40-panel-url.sh
RUN chmod +x /docker-entrypoint.d/40-panel-url.sh \
  && PANEL_URL=https://panel.ispcontrol.ai \
     API_PUBLIC_URL=/api \
     CONTACT_EMAIL=hola@ispcontrol.ai \
     REGISTER_URL=https://panel.ispcontrol.ai/login \
     envsubst '${PANEL_URL} ${API_PUBLIC_URL} ${CONTACT_EMAIL} ${REGISTER_URL}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
