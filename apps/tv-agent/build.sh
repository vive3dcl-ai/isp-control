#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$ROOT/dist}"
mkdir -p "$OUT"
cd "$ROOT"
go mod tidy
for pair in amd64 arm64; do
  echo "building linux/$pair..."
  CGO_ENABLED=0 GOOS=linux GOARCH="$pair" go build -ldflags="-s -w" -o "$OUT/isp-tv-agent-linux-$pair" .
done
cp install.sh "$OUT/install.sh"
cp VERSION "$OUT/VERSION"
chmod +x "$OUT/install.sh"
echo "artifacts in $OUT"
ls -la "$OUT"
