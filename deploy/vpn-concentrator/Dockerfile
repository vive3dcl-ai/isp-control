FROM alpine:3.24

RUN apk add --no-cache \
    openvpn \
    wireguard-tools \
    openssl \
    curl \
    python3 \
    iproute2 \
    iptables \
    bash

COPY deploy/vpn-concentrator/auth-user-pass.sh /usr/local/bin/auth-user-pass.sh
COPY deploy/vpn-concentrator/entrypoint.sh /entrypoint.sh
RUN chmod +x /usr/local/bin/auth-user-pass.sh /entrypoint.sh \
    && mkdir -p /pki /runtime /runtime/ccd

ENV VPN_PKI_DIR=/pki \
    VPN_RUNTIME_DIR=/runtime \
    VPN_SYNC_INTERVAL_SEC=30

VOLUME ["/pki", "/runtime"]

EXPOSE 1194/tcp 1195/udp 51820/udp

ENTRYPOINT ["/entrypoint.sh"]
