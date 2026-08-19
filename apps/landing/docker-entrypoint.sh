#!/bin/sh
set -eu
PANEL_URL="${PANEL_URL:-https://panel.ispcontrol.ai}"
API_PUBLIC_URL="${API_PUBLIC_URL:-/api}"
CONTACT_EMAIL="${CONTACT_EMAIL:-hola@ispcontrol.ai}"
REGISTER_URL="${REGISTER_URL:-/register.html}"
# Si viene vacío desde compose, usa la página de registro del landing.
if [ -z "${REGISTER_URL}" ]; then
  REGISTER_URL="/register.html"
fi
export PANEL_URL API_PUBLIC_URL CONTACT_EMAIL REGISTER_URL
envsubst '${PANEL_URL} ${API_PUBLIC_URL} ${CONTACT_EMAIL} ${REGISTER_URL}' \
  < /usr/share/nginx/html/config.js.template \
  > /usr/share/nginx/html/config.js
