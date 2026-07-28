#!/bin/sh
# API: instala rutas hacia el concentrador VPN y arranca Nest.
set -eu

ROUTES_SCRIPT="${VPN_ROUTES_SCRIPT:-/vpn-routes/install-routes.sh}"

if [ "$(id -u)" = "0" ]; then
  if [ -x "$ROUTES_SCRIPT" ] || [ -f "$ROUTES_SCRIPT" ]; then
    VPN_ROUTES_LABEL="${VPN_ROUTES_LABEL:-isp-control-api}" \
      VPN_ROUTES_BACKGROUND=1 \
      sh "$ROUTES_SCRIPT" || true
  else
    echo "isp-control-api: WARN no hay ${ROUTES_SCRIPT}"
  fi
  if command -v su-exec >/dev/null 2>&1; then
    exec su-exec node node dist/main.js
  fi
  exec node dist/main.js
fi

echo "isp-control-api: WARN no soy root — no puedo instalar ruta VPN"
exec node dist/main.js
