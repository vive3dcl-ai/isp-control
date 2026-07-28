#!/bin/sh
# Dev API: rutas VPN (si hay gateway) + nest watch (o comando override).
set -eu

ROUTES_SCRIPT="${VPN_ROUTES_SCRIPT:-/vpn-routes/install-routes.sh}"

if [ "$(id -u)" = "0" ] && [ -f "$ROUTES_SCRIPT" ]; then
  VPN_ROUTES_LABEL="${VPN_ROUTES_LABEL:-isp-control-api-dev}" \
    VPN_ROUTES_BACKGROUND=1 \
    sh "$ROUTES_SCRIPT" || true
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec npm run start:dev
