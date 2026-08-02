#!/bin/sh
# Concentrador ISP Control: OpenVPN TCP/UDP + WireGuard + sync API.
set -eu

API_URL="${VPN_SYNC_API_URL:-http://api:3000/api/internal/vpn/concentrator-state}"
SECRET="${VPN_SYNC_SECRET:-}"
PKI_DIR="${VPN_PKI_DIR:-/pki}"
RUNTIME="${VPN_RUNTIME_DIR:-/runtime}"
SYNC_INTERVAL="${VPN_SYNC_INTERVAL_SEC:-30}"
TCP_PORT="${VPN_PORT_OPENVPN_TCP:-1194}"
UDP_PORT="${VPN_PORT_OPENVPN_UDP:-1195}"
WG_PORT="${VPN_PORT_WIREGUARD:-51820}"
WG_PRIV="${VPN_WIREGUARD_SERVER_PRIVATE_KEY:-}"

# TCP y UDP son dos procesos OpenVPN con tun y pool propios (10.69.0.0/17 y
# 10.69.128.0/17): compartir el pool haría que ambos instalaran la misma ruta.
CCD_DIR_TCP="$RUNTIME/ccd-tcp"
CCD_DIR_UDP="$RUNTIME/ccd-udp"
USERS_FILE="$RUNTIME/users"
ROUTES_TCP="$RUNTIME/server-routes-tcp.conf"
ROUTES_UDP="$RUNTIME/server-routes-udp.conf"
SERVER_IPS_TCP="$RUNTIME/server-ips-tcp.txt"
SERVER_IPS_UDP="$RUNTIME/server-ips-udp.txt"
# "<ip del peer> <red>" por túnel: red del túnel + LAN detrás del router.
SNAT_TCP="$RUNTIME/snat-tcp.txt"
SNAT_UDP="$RUNTIME/snat-udp.txt"
WG_CONF="$RUNTIME/wg0.conf"
STATE_HASH_FILE="$RUNTIME/.state.hash"

mkdir -p "$PKI_DIR" "$RUNTIME" "$CCD_DIR_TCP" "$CCD_DIR_UDP" /dev/net
# Restos del layout anterior (un solo CCD compartido)
rm -rf "$RUNTIME/ccd" "$RUNTIME/server-routes.conf" 2>/dev/null || true
if [ ! -e /dev/net/tun ]; then
  echo "ERROR: falta /dev/net/tun"
  exit 1
fi
sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true
# Evitar drops por reverse-path cuando API llega por eth0 y sale por tun0
sysctl -w net.ipv4.conf.all.rp_filter=0 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf.default.rp_filter=0 >/dev/null 2>&1 || true

SERVER_IPS_FILE="$RUNTIME/server-ips.txt"
# Con network_mode:service, GenieACS escucha en este netns (no hay DNS "acs").
ACS_HOST="${VPN_ACS_HOST:-127.0.0.1}"
ACS_CWMP_PORT="${GENIEACS_CWMP_PORT:-14501}"
ACS_NBI_PORT="${GENIEACS_NBI_PORT:-7557}"
ACS_FS_PORT="${GENIEACS_FS_PORT:-7567}"

setup_docker_forwarding() {
  # Docker (api/acs) ↔ túnel OpenVPN/WG
  iptables -C FORWARD -j ACCEPT 2>/dev/null || iptables -A FORWARD -j ACCEPT
  # API/acs → MikroTik: SNAT para que el router conteste al peer del túnel
  for dev in tun0 tun1 wg0; do
    iptables -t nat -C POSTROUTING -o "$dev" -j MASQUERADE 2>/dev/null \
      || iptables -t nat -A POSTROUTING -o "$dev" -j MASQUERADE
  done
  # El handshake TLS de api-ssl manda el certificado en paquetes grandes: si el
  # PMTU del túnel es menor y el ICMP se pierde, la sesión se cuelga aunque el
  # ping ande. Clamp en ambos sentidos para no depender de PMTUD.
  for dev in tun0 tun1 wg0; do
    for dir in -o -i; do
      iptables -t mangle -C FORWARD "$dir" "$dev" -p tcp --tcp-flags SYN,RST SYN \
        -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
        || iptables -t mangle -A FORWARD "$dir" "$dev" -p tcp --tcp-flags SYN,RST SYN \
          -j TCPMSS --clamp-mss-to-pmtu
    done
  done
  # MikroTik → ACS (tras DNAT): SNAT para que ACS no necesite ruta 10.69
  iptables -t nat -C POSTROUTING -s 10.69.0.0/16 ! -o tun+ -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -s 10.69.0.0/16 ! -o tun+ -j MASQUERADE
  # Regla del layout anterior (solo tun0) — ya cubierta por tun+
  iptables -t nat -D POSTROUTING -s 10.69.0.0/16 ! -o tun0 -j MASQUERADE 2>/dev/null || true
  echo "vpn-concentrator: forwarding Docker↔túnel OK"
}

isolate_acs_admin_ports() {
  # GenieACS 1.2.13 no autentica NBI/FS. Al compartir netns con la VPN,
  # impedir que los peers alcancen esos listeners; API entra por eth0.
  for dev in tun+ wg0; do
    for port in "$ACS_NBI_PORT" "$ACS_FS_PORT"; do
      iptables -C INPUT -i "$dev" -p tcp --dport "$port" -j DROP 2>/dev/null \
        || iptables -A INPUT -i "$dev" -p tcp --dport "$port" -j DROP
    done
  done
  echo "vpn-concentrator: GenieACS NBI/FS aislados de peers VPN"
}

add_gateway_ips_to_dev() {
  # Cada túnel tiene serverAddress 10.69.x.1 — el cliente lo usa como peer.
  # OpenVPN solo pone el .1 del pool en el tun; añadimos los .1 secundarios.
  dev="$1"
  list="$2"
  ip link show "$dev" >/dev/null 2>&1 || return 0
  [ -f "$list" ] || return 0
  while IFS= read -r ip || [ -n "$ip" ]; do
    ip=$(echo "$ip" | tr -d '[:space:]')
    [ -n "$ip" ] || continue
    ip addr add "${ip}/24" dev "$dev" 2>/dev/null || true
  done <"$list"
}

apply_tunnel_snat() {
  # El router (y los equipos detrás) solo tienen ruta de vuelta al peer del
  # túnel (10.69.x.1). Sin esto el kernel usaría la IP primaria del tun
  # (10.69.0.1, por el route-gateway del pool) y la respuesta se va por el WAN.
  #
  # Cadena propia que se reescribe entera en cada sync: el orden importa (una
  # /8 publicada por otro túnel taparía la /24 propia) y con reglas sueltas en
  # POSTROUTING el orden dependía de cuándo se insertó cada una. Los archivos
  # vienen ordenados de más específico a más amplio.
  iptables -t nat -N ISP_VPN_SNAT 2>/dev/null || true
  iptables -t nat -C POSTROUTING -j ISP_VPN_SNAT 2>/dev/null \
    || iptables -t nat -I POSTROUTING 1 -j ISP_VPN_SNAT
  iptables -t nat -F ISP_VPN_SNAT

  for pair in "tun0:$SNAT_TCP" "tun1:$SNAT_UDP"; do
    dev="${pair%%:*}"
    list="${pair#*:}"
    ip link show "$dev" >/dev/null 2>&1 || continue
    [ -f "$list" ] || continue
    while IFS=' ' read -r src cidr || [ -n "$src" ]; do
      [ -n "$src" ] && [ -n "$cidr" ] || continue
      iptables -t nat -A ISP_VPN_SNAT -d "$cidr" -o "$dev" -j SNAT \
        --to-source "$src"
    done <"$list"
  done
}

sync_tunnel_gateway_ips() {
  add_gateway_ips_to_dev tun0 "$SERVER_IPS_TCP"
  add_gateway_ips_to_dev tun1 "$SERVER_IPS_UDP"
  apply_tunnel_snat

  # CWMP hacia GenieACS (ACS URL = http://10.69.x.1:14501).
  # Con network_mode service, ACS escucha en este netns → 127.0.0.1.
  case "$ACS_HOST" in
    '' ) acs_ip="" ;;
    *.*.*.* | *:* ) acs_ip="$ACS_HOST" ;;
    *)
      acs_ip="$(getent hosts "$ACS_HOST" 2>/dev/null | awk '{print $1; exit}')"
      ;;
  esac
  if [ -n "$acs_ip" ] && [ -f "$SERVER_IPS_FILE" ]; then
    while IFS= read -r ip || [ -n "$ip" ]; do
      ip=$(echo "$ip" | tr -d '[:space:]')
      [ -n "$ip" ] || continue
      iptables -t nat -C PREROUTING -d "$ip" -p tcp --dport "$ACS_CWMP_PORT" \
        -j DNAT --to-destination "${acs_ip}:${ACS_CWMP_PORT}" 2>/dev/null \
        || iptables -t nat -A PREROUTING -d "$ip" -p tcp --dport "$ACS_CWMP_PORT" \
          -j DNAT --to-destination "${acs_ip}:${ACS_CWMP_PORT}"
    done <"$SERVER_IPS_FILE"
    # también 10.69.0.1 (IP del server OpenVPN)
    iptables -t nat -C PREROUTING -d 10.69.0.1 -p tcp --dport "$ACS_CWMP_PORT" \
      -j DNAT --to-destination "${acs_ip}:${ACS_CWMP_PORT}" 2>/dev/null \
      || iptables -t nat -A PREROUTING -d 10.69.0.1 -p tcp --dport "$ACS_CWMP_PORT" \
        -j DNAT --to-destination "${acs_ip}:${ACS_CWMP_PORT}"
  fi
}

cidr_to_mask() { :; }

init_pki() {
  if [ -f "$PKI_DIR/ca.crt" ] && [ -f "$PKI_DIR/server.crt" ] && [ -f "$PKI_DIR/server.key" ] && [ -f "$PKI_DIR/dh.pem" ]; then
    return 0
  fi
  echo "vpn-concentrator: generando PKI OpenVPN…"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$PKI_DIR/ca.key" -out "$PKI_DIR/ca.crt" \
    -subj "/CN=isp-control-vpn-ca"
  openssl req -newkey rsa:2048 -nodes \
    -keyout "$PKI_DIR/server.key" -out "$PKI_DIR/server.csr" \
    -subj "/CN=isp-control-vpn-server"
  openssl x509 -req -in "$PKI_DIR/server.csr" -CA "$PKI_DIR/ca.crt" -CAkey "$PKI_DIR/ca.key" \
    -CAcreateserial -out "$PKI_DIR/server.crt" -days 3650
  openssl dhparam -out "$PKI_DIR/dh.pem" 2048
  rm -f "$PKI_DIR/server.csr"
  chmod 600 "$PKI_DIR/server.key" "$PKI_DIR/ca.key"
  echo "vpn-concentrator: PKI lista"
}

write_server_conf() {
  proto="$1"
  port="$2"
  # tun0=tcp, tun1=udp — dos procesos no pueden compartir tun ni pool
  if [ "$proto" = "tcp" ]; then
    tun_dev="tun0"
    pool="10.69.0.0 255.255.128.0"
    ccd="$CCD_DIR_TCP"
    routes="$ROUTES_TCP"
  else
    tun_dev="tun1"
    pool="10.69.128.0 255.255.128.0"
    ccd="$CCD_DIR_UDP"
    routes="$ROUTES_UDP"
  fi
  conf="$RUNTIME/server-${proto}.conf"
  cat >"$conf" <<EOF
port ${port}
proto ${proto}
dev ${tun_dev}
topology subnet
server ${pool}
ca ${PKI_DIR}/ca.crt
cert ${PKI_DIR}/server.crt
key ${PKI_DIR}/server.key
dh ${PKI_DIR}/dh.pem
client-config-dir ${ccd}
username-as-common-name
verify-client-cert none
script-security 3
auth-user-pass-verify /usr/local/bin/auth-user-pass.sh via-env
setenv OPENVPN_USERS_FILE ${USERS_FILE}
cipher AES-256-CBC
data-ciphers AES-256-CBC
auth SHA1
keepalive 10 120
reneg-sec 0
persist-key
persist-tun
duplicate-cn
status ${RUNTIME}/openvpn-status-${proto}.log 5
status-version 2
verb 3
config ${routes}
EOF
}
fetch_state() {
  if [ -z "$SECRET" ]; then
    echo "WARN: VPN_SYNC_SECRET vacío — sync deshabilitado"
    return 1
  fi
  curl -fsS -H "X-VPN-SYNC-SECRET: ${SECRET}" "$API_URL"
}

apply_state() {
  json="$1"
  tmp="$RUNTIME/state.json"
  echo "$json" >"$tmp"

  : >"$USERS_FILE"
  rm -f "$CCD_DIR_TCP"/* "$CCD_DIR_UDP"/*
  for f in "$ROUTES_TCP" "$ROUTES_UDP"; do
    echo "# auto routes from sync" >"$f"
  done

  python3 - "$tmp" "$USERS_FILE" "$CCD_DIR_TCP" "$CCD_DIR_UDP" "$ROUTES_TCP" \
    "$ROUTES_UDP" "$WG_CONF" "$WG_PRIV" "$WG_PORT" "$SERVER_IPS_FILE" \
    "$SERVER_IPS_TCP" "$SERVER_IPS_UDP" "$SNAT_TCP" "$SNAT_UDP" <<'PY'
import json, sys, os, ipaddress

(state_path, users_path, ccd_tcp, ccd_udp, routes_tcp, routes_udp,
 wg_path, priv, port, ips_path, ips_tcp_path, ips_udp_path,
 snat_tcp_path, snat_udp_path) = sys.argv[1:15]
with open(state_path) as f:
    data = json.load(f)

# Pool por transporte — debe coincidir con VPN_OPENVPN_SERVER_POOLS en la API.
POOLS = {
    "openvpn_tcp": (ipaddress.ip_network("10.69.0.0/17"), ccd_tcp, routes_tcp),
    "openvpn_udp": (ipaddress.ip_network("10.69.128.0/17"), ccd_udp, routes_udp),
}

seen_routes = set()
server_ips = set()
per_proto = {p: {"routes": set(), "ips": set(), "snat": set()} for p in POOLS}
# OpenVPN admite un solo dueño por iroute: si dos clientes del mismo túnel
# publican la misma LAN, gana el último en conectarse y esa red queda
# inalcanzable para el panel. Solo el primero la anuncia. Se agrupa por túnel
# (server address) para no alterar el comportamiento entre túneles distintos,
# donde los rangos por defecto (RFC1918) suelen solaparse.
claimed_iroutes = {}
users = data.get("openvpnUsers") or []
with open(users_path, "w") as uf:
    for u in users:
        user = u.get("username") or ""
        pw = u.get("password") or ""
        client = (u.get("clientAddress") or "").strip()
        server = (u.get("serverAddress") or "").strip()
        proto = u.get("protocol") or "openvpn_tcp"
        if proto not in POOLS:
            continue
        pool, ccd_dir, _ = POOLS[proto]
        if not user or not pw or not client:
            continue
        try:
            if ipaddress.ip_address(client) not in pool:
                print(
                    f"WARN: túnel {user} ({proto}) usa {client}, fuera de {pool}"
                    " — recréalo para que el concentrador pueda servirlo",
                    file=sys.stderr,
                )
                continue
        except ValueError:
            continue
        if server:
            server_ips.add(server)
            per_proto[proto]["ips"].add(server)
        uf.write(f"{user} {pw}\n")
        # /24 a propósito: cada tenant ve solo su túnel on-link (el .1 del
        # servidor se añade como IP secundaria en el tun correspondiente).
        lines = [f"ifconfig-push {client} 255.255.255.0"]
        try:
            net = ipaddress.ip_network(client + "/24", strict=False)
            lines.append(f"iroute {net.network_address} 255.255.255.0")
            seen_routes.add(f"{net.network_address}/24")
            # OJO: sin "route" para el /24 del túnel. Ya está cubierto por la
            # ruta del pool, y OpenVPN lo instalaría como ruta con gateway
            # (via 10.69.0.2) que le gana a la on-link de la IP secundaria: el
            # kernel elegiría como origen el .1 del pool (10.69.0.1) en vez del
            # .1 del túnel, y el router no tiene ruta de vuelta a esa IP.
            if server:
                per_proto[proto]["snat"].add(
                    (server, f"{net.network_address}/24")
                )
        except Exception:
            pass
        claimed = claimed_iroutes.setdefault((proto, server), set())
        for cidr in u.get("lanRoutes") or []:
            cidr = (cidr or "").strip()
            if not cidr:
                continue
            try:
                net = ipaddress.ip_network(cidr, strict=False)
                mask = str(net.netmask)
                if str(net) in claimed:
                    print(
                        f"WARN: {net} ya la publica otro cliente del túnel {server}"
                        f" — {user} no la anuncia (iroute admite un solo dueño)",
                        file=sys.stderr,
                    )
                else:
                    claimed.add(str(net))
                    lines.append(f"iroute {net.network_address} {mask}")
                seen_routes.add(str(net))
                per_proto[proto]["routes"].add(str(net))
                # Los equipos detrás del router tampoco saben volver a
                # 10.69.0.1: mismo SNAT al peer del túnel.
                if server:
                    per_proto[proto]["snat"].add((server, str(net)))
            except Exception:
                continue
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in user)
        with open(os.path.join(ccd_dir, safe), "w") as cf:
            cf.write("\n".join(lines) + "\n")
        exact = os.path.join(ccd_dir, user)
        if exact != os.path.join(ccd_dir, safe):
            try:
                os.remove(exact)
            except FileNotFoundError:
                pass
            os.symlink(safe, exact)

for proto, (_pool, _ccd, routes_path) in POOLS.items():
    with open(routes_path, "a") as rf:
        for cidr in sorted(per_proto[proto]["routes"]):
            try:
                net = ipaddress.ip_network(cidr, strict=False)
                rf.write(f"route {net.network_address} {net.netmask}\n")
            except Exception:
                pass

for path, proto in ((ips_tcp_path, "openvpn_tcp"), (ips_udp_path, "openvpn_udp")):
    with open(path, "w") as f:
        for ip in sorted(per_proto[proto]["ips"]):
            f.write(ip + "\n")

def snat_order(entry):
    # Más específico primero: la /24 del túnel debe ganarle a una /8 publicada
    # por otro túnel sobre el mismo tun.
    src, cidr = entry
    try:
        return (-ipaddress.ip_network(cidr).prefixlen, cidr, src)
    except ValueError:
        return (0, cidr, src)


for path, proto in ((snat_tcp_path, "openvpn_tcp"), (snat_udp_path, "openvpn_udp")):
    with open(path, "w") as f:
        for src, cidr in sorted(per_proto[proto]["snat"], key=snat_order):
            f.write(f"{src} {cidr}\n")

# Lista plana de CIDRs LAN/túnel para que api/acs instalen rutas vía este contenedor
lan_list = os.path.join(os.path.dirname(routes_tcp), "lan-routes.txt")
with open(lan_list, "w") as lf:
    for cidr in sorted(seen_routes):
        lf.write(cidr + "\n")

wg = data.get("wireguard") or {}
priv = priv or wg.get("privateKey") or ""
peers = wg.get("peers") or []
addrs = []
for p in peers:
    sa = p.get("serverAddress")
    if sa:
        a = f"{sa}/24"
        if a not in addrs:
            addrs.append(a)
        server_ips.add(sa)
lines = [
    "# isp-control WireGuard concentrator (auto)",
    "[Interface]",
    f"PrivateKey = {priv}",
    f"ListenPort = {port}",
]
if addrs:
    lines.append("Address = " + ", ".join(addrs))
lines.append("")
for p in peers:
    pk = p.get("clientPublicKey") or ""
    ca = p.get("clientAddress") or ""
    if not pk or not ca:
        continue
    allowed = [f"{ca}/32"] + [r for r in (p.get("lanRoutes") or []) if r]
    lines += [
        "[Peer]",
        f"PublicKey = {pk}",
        f"AllowedIPs = {', '.join(allowed)}",
        "",
    ]
with open(wg_path, "w") as f:
    f.write("\n".join(lines).rstrip() + "\n")
with open(ips_path, "w") as f:
    for ip in sorted(server_ips):
        f.write(ip + "\n")
PY

  chmod 644 "$USERS_FILE" 2>/dev/null || true
  chmod 600 "$WG_CONF" 2>/dev/null || true
  sync_tunnel_gateway_ips
}

wg_reload() {
  if [ ! -f "$WG_CONF" ]; then
    return 0
  fi
  if ! grep -q '^PrivateKey = .\+' "$WG_CONF" 2>/dev/null; then
    echo "vpn-concentrator: WireGuard sin private key — skip"
    return 0
  fi
  if ip link show wg0 >/dev/null 2>&1; then
    wg-quick strip "$WG_CONF" >"$RUNTIME/wg0.strip" 2>/dev/null || cp "$WG_CONF" "$RUNTIME/wg0.strip"
    wg syncconf wg0 "$RUNTIME/wg0.strip" 2>/dev/null \
      || (wg-quick down wg0 2>/dev/null || true; wg-quick up "$WG_CONF" || true)
  else
    wg-quick up "$WG_CONF" || true
  fi
  dump_wg_peers
}

dump_wg_peers() {
  # Formato: <allowed_ip> <handshake_epoch>  (para status connected en la API)
  : >"$RUNTIME/wg-peers.txt"
  if ! ip link show wg0 >/dev/null 2>&1; then
    return 0
  fi
  wg show wg0 dump 2>/dev/null | tail -n +2 | while IFS=$'\t' read -r _pub _psk endpoint allowed handshake _rest; do
    [ -n "$allowed" ] || continue
    ip="${allowed%%/*}"
    echo "${ip} ${handshake:-0}" >>"$RUNTIME/wg-peers.txt"
  done
}

# Lista simple de clientes OVPN conectados (CN + IP virtual) para la API
dump_ovpn_clients() {
  out_cn="$RUNTIME/connected-clients.txt"
  out_ip="$RUNTIME/connected-ips.txt"
  : >"$out_cn"
  : >"$out_ip"
  python3 - "$out_cn" "$out_ip" "$RUNTIME/openvpn-status-tcp.log" \
    "$RUNTIME/openvpn-status-udp.log" <<'PY'
import sys
out_cn, out_ip = sys.argv[1:3]
status_paths = sys.argv[3:]
cns, ips = set(), set()
texts = []
for path in status_paths:
    try:
        texts.append(open(path, encoding="utf-8", errors="ignore").read())
    except OSError:
        continue

section = None
for raw in "\n".join(texts).splitlines():
    line = raw.strip()
    if not line:
        continue
    # status-version 1
    if line.startswith("OpenVPN CLIENT LIST") or line == "CLIENT LIST":
        section = "clients_v1"
        continue
    if line.startswith("ROUTING TABLE"):
        section = "routing_v1"
        continue
    if line.startswith("GLOBAL STATS") or line == "END":
        section = None
        continue
    if section == "clients_v1":
        if line.startswith("Updated") or line.startswith("Common Name"):
            continue
        cn = line.split(",")[0].strip()
        if cn:
            cns.add(cn)
        continue
    if section == "routing_v1":
        if line.startswith("Virtual Address"):
            continue
        parts = line.split(",")
        if len(parts) >= 2:
            vip, cn = parts[0].strip(), parts[1].strip()
            if vip:
                ips.add(vip)
            if cn:
                cns.add(cn)
        continue
    # status-version 2/3 CSV
    if line.startswith("CLIENT_LIST,"):
        parts = line.split(",")
        # CLIENT_LIST,Common Name,Real Address,Virtual Address,...
        if len(parts) >= 4:
            cn, vip = parts[1].strip(), parts[3].strip()
            if cn:
                cns.add(cn)
            if vip and vip[0].isdigit():
                ips.add(vip)
        continue
    if line.startswith("ROUTING_TABLE,"):
        parts = line.split(",")
        # ROUTING_TABLE,Virtual Address,Common Name,...
        if len(parts) >= 3:
            vip, cn = parts[1].strip(), parts[2].strip()
            if vip:
                ips.add(vip)
            if cn:
                cns.add(cn)

with open(out_cn, "w") as f:
    f.write("\n".join(sorted(cns)) + ("\n" if cns else ""))
with open(out_ip, "w") as f:
    f.write("\n".join(sorted(ips)) + ("\n" if ips else ""))
PY
}

signal_openvpn() {
  if [ -f /var/run/openvpn-tcp.pid ]; then
    kill -HUP "$(cat /var/run/openvpn-tcp.pid)" 2>/dev/null || true
  fi
  if [ -f /var/run/openvpn-udp.pid ]; then
    kill -HUP "$(cat /var/run/openvpn-udp.pid)" 2>/dev/null || true
  fi
}

openvpn_alive() {
  pidfile="/var/run/openvpn-$1.pid"
  [ -f "$pidfile" ] || return 1
  kill -0 "$(cat "$pidfile")" 2>/dev/null
}

ensure_openvpn_running() {
  proto="$1"
  openvpn_alive "$proto" && return 0
  echo "vpn-concentrator: OpenVPN ${proto} caído — reiniciando"
  openvpn --writepid "/var/run/openvpn-${proto}.pid" \
    --config "$RUNTIME/server-${proto}.conf" --daemon "openvpn-${proto}" \
    || echo "ERROR: OpenVPN ${proto} no arrancó"
}

# Hash estable (ignora generatedAt) + contenido aplicado en disco
content_fingerprint() {
  python3 - <<'PY'
import hashlib, json, os, sys
runtime = os.environ.get("VPN_RUNTIME_DIR", "/runtime")
state = os.path.join(runtime, "state.json")
h = hashlib.sha256()
if os.path.isfile(state):
    with open(state) as f:
        data = json.load(f)
    data.pop("generatedAt", None)
    h.update(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())
for name in ("users", "server-routes-tcp.conf", "server-routes-udp.conf", "wg0.conf"):
    path = os.path.join(runtime, name)
    h.update(b"\0" + name.encode())
    if os.path.isfile(path):
        with open(path, "rb") as f:
            h.update(f.read())
for ccd_name in ("ccd-tcp", "ccd-udp"):
    ccd = os.path.join(runtime, ccd_name)
    if not os.path.isdir(ccd):
        continue
    for fn in sorted(os.listdir(ccd)):
        path = os.path.join(ccd, fn)
        if os.path.isfile(path) and not os.path.islink(path):
            h.update(b"\0" + ccd_name.encode() + b"/" + fn.encode())
            with open(path, "rb") as f:
                h.update(f.read())
print(h.hexdigest())
PY
}

sync_once() {
  json="$(fetch_state)" || return 1
  echo "$json" >"$RUNTIME/state.json"
  old=""
  [ -f "$STATE_HASH_FILE" ] && old="$(cat "$STATE_HASH_FILE")"
  apply_state "$json"
  hash="$(content_fingerprint)"
  if [ "$hash" = "$old" ]; then
    sync_tunnel_gateway_ips
    return 0
  fi
  echo "$hash" >"$STATE_HASH_FILE"
  wg_reload
  sync_tunnel_gateway_ips
  # Solo HUP si ya había estado previo (reload CCD/routes). Auth lee users en cada login.
  if [ -n "$old" ]; then
    echo "vpn-concentrator: peers/CCD cambiaron — HUP OpenVPN"
    signal_openvpn
  else
    echo "vpn-concentrator: sync inicial OK"
  fi
  return 0
}

init_pki
: >"$USERS_FILE"
: >"$SERVER_IPS_FILE"
: >"$SERVER_IPS_TCP"
: >"$SERVER_IPS_UDP"
: >"$SNAT_TCP"
: >"$SNAT_UDP"
echo "# routes" >"$ROUTES_TCP"
echo "# routes" >"$ROUTES_UDP"
write_server_conf tcp "$TCP_PORT"
write_server_conf udp "$UDP_PORT"

# Primera sync (API puede no estar lista)
i=0
while [ "$i" -lt 60 ]; do
  if sync_once; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

echo "vpn-concentrator: arrancando OpenVPN TCP :${TCP_PORT} (10.69.0.0/17) UDP :${UDP_PORT} (10.69.128.0/17) WG :${WG_PORT}"
openvpn --writepid /var/run/openvpn-tcp.pid --config "$RUNTIME/server-tcp.conf" --daemon openvpn-tcp \
  || echo "ERROR: OpenVPN TCP no arrancó"
openvpn --writepid /var/run/openvpn-udp.pid --config "$RUNTIME/server-udp.conf" --daemon openvpn-udp \
  || echo "ERROR: OpenVPN UDP no arrancó"
sleep 1
setup_docker_forwarding
isolate_acs_admin_ports
wg_reload
sync_tunnel_gateway_ips
dump_wg_peers
dump_ovpn_clients

# Dump de peers cada 5s; sync API cada SYNC_INTERVAL
elapsed=0
while true; do
  sleep 5
  elapsed=$((elapsed + 5))
  ensure_openvpn_running tcp
  ensure_openvpn_running udp
  dump_wg_peers
  dump_ovpn_clients
  if [ "$elapsed" -ge "$SYNC_INTERVAL" ]; then
    sync_once || true
    elapsed=0
  fi
done
