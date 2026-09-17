#!/bin/bash
set -Eeuo pipefail

load_secret() {
    local name="$1" canonical="/run/secrets/$1" legacy="/run/secrets/${1,,}"
    if [[ -f "$canonical" && -f "$legacy" ]]; then
        echo "$name has ambiguous file-secret names; keep only the uppercase file" >&2
        exit 1
    fi
    if [[ -f "$legacy" ]]; then
        echo "$name uses a legacy file-secret name; rename it to uppercase" >&2
        exit 1
    fi
    if [[ -z "${!name:-}" && -f "$canonical" ]]; then
        printf -v "$name" '%s' "$(<"$canonical")"
        export "$name"
    fi
}

load_secret BETTER_AUTH_SECRET
load_secret SYSTEM_KEY
load_secret ADMIN_PASSPHRASE
: "${BETTER_AUTH_SECRET:?Set a persistent BETTER_AUTH_SECRET}"
: "${SYSTEM_KEY:?Set a persistent SYSTEM_KEY}"
: "${ADMIN_PASSPHRASE:?Set ADMIN_PASSPHRASE}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export ASTERISM_CONFIG_PROFILE=production

echo "Validating configuration and migrating authentication schema"
cd /app/apps/frontend
node node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth-cli.ts --yes

echo "STORAGE_ROOT=${STORAGE_ROOT:-/storage}"
mkdir -p "$STORAGE_ROOT"

cd /app/apps/backend
# The existing initializer resets databases; run it only for a fresh local DB.
if [[ -z "${DB_URL:-}" && ! -f "$STORAGE_ROOT/database.db" ]]; then
    .venv/bin/python -m asterism.db.init_db
fi

pids=()
shutdown() {
    trap '' TERM INT
    kill -TERM "${pids[@]}" 2>/dev/null || true
    # Bound shutdown even if a child stops responding.
    (sleep 20; kill -KILL "${pids[@]}" 2>/dev/null || true) &
    local watchdog=$!
    for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
    kill "$watchdog" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

.venv/bin/uvicorn asterism.main:app --host 127.0.0.1 --port 8000 \
    --proxy-headers --forwarded-allow-ips=127.0.0.1 &
pids+=("$!")
cd /app/apps/frontend
node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3001 &
pids+=("$!")
nginx -c /app/docker/nginx.conf -g 'daemon off;' &
pids+=("$!")

# A dead service must stop the whole container so restart policies can recover.
status=0
wait -n "${pids[@]}" || status=$?
echo "A service exited (status $status); stopping container" >&2
shutdown
exit 1
