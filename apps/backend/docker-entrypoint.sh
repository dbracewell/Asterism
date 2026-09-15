#!/bin/sh
set -eu

: "${STORAGE_ROOT:=/storage}"

if [ ! -f "$STORAGE_ROOT/database.db" ]; then
    echo "Initializing backend database..."
    /app/.venv/bin/python -m asterism.db.init_db
fi

exec /app/.venv/bin/uvicorn asterism.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --proxy-headers \
    --forwarded-allow-ips '*'
