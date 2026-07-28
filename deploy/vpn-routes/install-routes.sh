#!/bin/sh
# Instala rutas Docker → gateway VPN (concentrador o lab-vpnacs).
# Uso: VPN_ROUTE_GATEWAY_HOST / VPN_ROUTE_GATEWAY_IP / VPN_TUNNEL_CIDR / VPN_RUNTIME_STATUS_DIR
# Corre en loop (foreground si VPN_ROUTES_ONCE=1, si no background forever).
set -eu

VPN_CIDR="${VPN_TUNNEL_CIDR:-10.69.0.0/16}"
VPN_HOST="${VPN_ROUTE_GATEWAY_HOST:-vpn-concentrator}"
RUNTIME_DIR="${VPN_RUNTIME_STATUS_DIR:-/vpn-runtime}"
LAN_ROUTES_FILE="${RUNTIME_DIR}/lan-routes.txt"
LABEL="${VPN_ROUTES_LABEL:-isp-control-vpn-routes}"

resolve_vpn_gw() {
  if [ -n "${VPN_ROUTE_GATEWAY_IP:-}" ]; then
    echo "$VPN_ROUTE_GATEWAY_IP"
    return 0
  fi
  getent hosts "$VPN_HOST" 2>/dev/null | awk '{print $1; exit}'
}

default_gw() {
  ip route show default 2>/dev/null | awk '{print $3; exit}'
}

is_forbidden_cidr() {
  case "$1" in
    127.*|0.0.0.0/0|::/0) return 0 ;;
  esac
  return 1
}

install_via_vpn() {
  cidr="$1"
  gw="$2"
  metric="${3:-50}"
  [ -n "$cidr" ] || return 0
  is_forbidden_cidr "$cidr" && return 0
  if ip route show "$cidr" 2>/dev/null | grep -q 'proto kernel'; then
    return 0
  fi
  ip route replace "$cidr" via "$gw" metric "$metric" 2>/dev/null || true
}

ensure_vpn_route() {
  if ! command -v ip >/dev/null 2>&1; then
    echo "${LABEL}: 'ip' no disponible (instala iproute2)"
    return 1
  fi
  gw="$(resolve_vpn_gw || true)"
  if [ -z "$gw" ]; then
    echo "${LABEL}: esperando DNS/IP de ${VPN_HOST}…"
    return 1
  fi
  dgw="$(default_gw || true)"
  if [ -n "$dgw" ] && [ "$gw" = "$dgw" ]; then
    echo "${LABEL}: ERROR ${VPN_HOST} resolvió a gateway Docker (${gw}); no instalar ruta"
    return 1
  fi

  ip route del "$VPN_CIDR" 2>/dev/null || true
  if ! ip route replace "$VPN_CIDR" via "$gw" metric 50; then
    echo "${LABEL}: falló ip route replace ${VPN_CIDR} via ${gw}"
    return 1
  fi

  # RFC1918 vía VPN; la ruta connected de Docker gana para isp_net.
  install_via_vpn "10.0.0.0/8" "$gw" 100
  install_via_vpn "172.16.0.0/12" "$gw" 100
  install_via_vpn "192.168.0.0/16" "$gw" 100

  if [ -f "$LAN_ROUTES_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      c="$(echo "$line" | tr -d '[:space:]')"
      [ -n "$c" ] || continue
      case "$c" in \#*) continue ;; esac
      install_via_vpn "$c" "$gw" 50
    done <"$LAN_ROUTES_FILE"
  fi

  via="$(ip route get 10.69.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="via"){print $(i+1); exit}}')"
  if [ -z "$via" ] || [ "$via" != "$gw" ]; then
    echo "${LABEL}: verificación falló (via=${via:-?} esperado=${gw})"
    return 1
  fi
  sample_via="$(ip route get 10.0.0.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="via"){print $(i+1); exit}}')"
  echo "${LABEL}: OK overlay via ${gw}; LAN sample 10.0.0.1 via ${sample_via:-?}"
  return 0
}

run_loop() {
  i=0
  while [ "$i" -lt 120 ]; do
    if ensure_vpn_route; then
      break
    fi
    i=$((i + 1))
    sleep 2
  done
  if [ "${VPN_ROUTES_ONCE:-0}" = "1" ]; then
    return 0
  fi
  while true; do
    sleep 15
    ensure_vpn_route || true
  done
}

if [ "${VPN_ROUTES_BACKGROUND:-1}" = "1" ] && [ "${VPN_ROUTES_ONCE:-0}" != "1" ]; then
  run_loop &
else
  run_loop
fi
