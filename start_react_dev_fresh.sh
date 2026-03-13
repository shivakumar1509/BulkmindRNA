#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/data/shiv/Bulk_RNA_Seq/codes/react"
PORT=3000
DEV_CONTAINER="react-bg-dev"
NODE_IMAGE="node:18-bullseye"
DOCKER_NETWORK="bulk-rna-net"

echo "[1/4] Killing anything listening on port ${PORT}..."

PIDS=$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "  Killing PIDs: $PIDS"
  kill $PIDS || true
else
  echo "  Nothing listening on ${PORT}"
fi

echo "[2/4] Stopping & removing old Docker dev container (if any)..."
docker rm -f "${DEV_CONTAINER}" 2>/dev/null || true

echo "[3/4] Starting fresh React dev server in Docker..."

cd "${APP_DIR}"

docker run -d --name "${DEV_CONTAINER}" \
  --network "${DOCKER_NETWORK}" \
  -v "$PWD":/app -w /app \
  -p ${PORT}:${PORT} \
  "${NODE_IMAGE}" \
  /bin/bash -lc "npm ci && npm run dev -- --host 0.0.0.0 --port ${PORT}"

echo "[4/4] Done."
echo "React DEV running on port ${PORT}"
echo "Use: docker logs -f ${DEV_CONTAINER}"

