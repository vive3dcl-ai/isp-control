#!/bin/sh
# OpenVPN auth-user-pass-verify (via-env)
# username / password vienen del entorno que inyecta OpenVPN.
set -eu
USERS_FILE="${OPENVPN_USERS_FILE:-/runtime/users}"

if [ -z "${username:-}" ] || [ -z "${password:-}" ]; then
  exit 1
fi

if [ ! -f "$USERS_FILE" ]; then
  exit 1
fi

# Línea exacta: "user pass" (password puede tener espacios → match prefijo user + resto)
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  u="${line%% *}"
  p="${line#* }"
  if [ "$u" = "$username" ] && [ "$p" = "$password" ]; then
    exit 0
  fi
done <"$USERS_FILE"

exit 1
