#!/usr/bin/env bash
# Build + push imágenes públicas a Docker Hub (namespace dubidubidu).
# Uso:
#   docker login
#   ./scripts/docker-hub-push.sh              # tag=latest, lee .env.production
#   ./scripts/docker-hub-push.sh v1.0.0
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE (necesario para VITE_API_URL / PANEL_URL en el build del web/landing)."
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

USER_NS="${DOCKERHUB_USER:-dubidubidu}"
TAG="${1:-${IMAGE_TAG:-latest}}"
VITE_API_URL="${VITE_API_URL:?Define VITE_API_URL en $ENV_FILE}"
PANEL_URL="${PANEL_URL:-${PUBLIC_WEB_URL:-http://localhost}}"

echo "==> Namespace: $USER_NS  tag: $TAG"
echo "==> VITE_API_URL=$VITE_API_URL"
echo "==> PANEL_URL=$PANEL_URL (bake en landing vía runtime envsubst; build solo copia estáticos)"

build_push() {
  local name="$1"
  local dockerfile="$2"
  shift 2
  local image="${USER_NS}/${name}:${TAG}"
  echo ""
  echo "==> Building $image"
  docker build -f "$dockerfile" -t "$image" "$@" "$ROOT"
  echo "==> Pushing $image"
  docker push "$image"
}

build_push "isp-control-api" "apps/api/Dockerfile"
build_push "isp-control-web" "apps/web/Dockerfile" \
  --build-arg "VITE_API_URL=${VITE_API_URL}"
build_push "isp-control-landing" "apps/landing/Dockerfile"
build_push "isp-control-whatsapp-baileys" "apps/whatsapp-baileys/Dockerfile"

echo ""
echo "OK. En el servidor:"
echo "  DOCKERHUB_USER=$USER_NS IMAGE_TAG=$TAG docker compose -f docker-compose.prod.yml --env-file .env.production pull"
echo "  docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
