#!/bin/sh
set -eu
PANEL_URL="${PANEL_URL:-http://localhost}"
export PANEL_URL
envsubst '${PANEL_URL}' < /usr/share/nginx/html/config.js.template \
  > /usr/share/nginx/html/config.js
