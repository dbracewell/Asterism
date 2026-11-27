#!/bin/bash
set -Eeuo pipefail

# Reject unsupported worker overrides before secrets, migrations or storage writes.
cd /app/apps/backend
.venv/bin/python -m asterism.serve --check

source /app/docker/secrets.sh
# Every command, backup and verify included, sees the same secrets.
load_secret BETTER_AUTH_SECRET
load_secret SYSTEM_KEY
load_secret ADMIN_PASSPHRASE

backend_python() {
    (cd /app/apps/backend && env -u BETTER_AUTH_SECRET -u ADMIN_PASSPHRASE \
        ASTERISM_CONFIG_PROFILE=backend-init .venv/bin/python -m asterism.backup "$@")
}

# Backup and restore (US-86.4). `backup` runs beside the live app (docker exec);
# `restore` runs in place of it, into an empty storage volume.
command="${1:-}"
case "$command" in
    "") ;;
    backup)
        shift
        export BETTER_AUTH_DB_PATH="${BETTER_AUTH_DB_PATH:-${STORAGE_ROOT:-/storage}/users.db}"
        backend_python create --output-dir "${BACKUP_DIR:-/backups}" "$@"
        exit
        ;;
    verify)
        shift
        backend_python verify "$@"
        exit
        ;;
    setup)
        # US-101.1: write .env for a new installation into the directory mounted at /out.
        shift
        exec node /app/scripts/setup.mjs "$@"
        ;;
    restore)
        shift
        # Never fall through to starting the app: that would run it on the storage being restored.
        (( $# >= 1 )) || { echo "usage: restore /backups/asterism-backup-<time>.tar.gz" >&2; exit 2; }
        ;;
    *)
        echo "Unknown command: $1 (expected setup, backup, verify or restore)" >&2
        exit 2
        ;;
esac

: "${BETTER_AUTH_SECRET:?Set a persistent BETTER_AUTH_SECRET}"
: "${SYSTEM_KEY:?Set a persistent SYSTEM_KEY}"
: "${ADMIN_PASSPHRASE:?Set ADMIN_PASSPHRASE}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export ASTERISM_CONFIG_PROFILE=production

echo "Validating configuration"
node /app/scripts/config-check.mjs --profile production --scope all --env none
cd /app/apps/backend
env -u BETTER_AUTH_SECRET -u ADMIN_PASSPHRASE -u BETTER_AUTH_DB_PATH \
    .venv/bin/python -c 'from asterism.core import config; config.validate_runtime()'

if [[ "$command" == restore ]]; then
    export BETTER_AUTH_DB_PATH="${BETTER_AUTH_DB_PATH:-${STORAGE_ROOT:-/storage}/users.db}"
    # Checks the archive, restores it, and applies pending backend migrations.
    backend_python restore "$@"
    cd /app/apps/frontend
    env -u SYSTEM_KEY -u ADMIN_PASSPHRASE -u DB_URL \
        -u MAX_CHARS_FOR_RETRIEVAL -u CORS_ALLOWED_ORIGINS \
        -u DEFAULT_ALLOWED_TOOLS ASTERISM_CONFIG_PROFILE=auth-migrate \
        node node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth-cli.ts --yes
    echo "Restore complete; start the app normally"
    exit 0
fi
[[ -z "$command" ]] || { echo "Refusing to start the app for command $command" >&2; exit 2; }

cd /app/apps/frontend
env -u SYSTEM_KEY -u ADMIN_PASSPHRASE -u DB_URL \
    -u MAX_CHARS_FOR_RETRIEVAL -u CORS_ALLOWED_ORIGINS \
    -u DEFAULT_ALLOWED_TOOLS ASTERISM_CONFIG_PROFILE=auth-migrate \
    node node_modules/auth/dist/index.mjs migrate --config ./src/lib/auth-cli.ts --yes

# Upload limit, HSTS and trusted proxies for nginx, from the validated settings (US-86.5).
node /app/scripts/edge-config.mjs /tmp/asterism-nginx

echo "STORAGE_ROOT=${STORAGE_ROOT:-/storage}"
mkdir -p "$STORAGE_ROOT"

cd /app/apps/backend
# Apply pending schema migrations (ADR-0069); refuses a database newer than, or unknown to, this image.
env -u BETTER_AUTH_SECRET -u ADMIN_PASSPHRASE -u BETTER_AUTH_DB_PATH \
    .venv/bin/python -m asterism.db.init_db

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

env -u BETTER_AUTH_SECRET -u ADMIN_PASSPHRASE -u BETTER_AUTH_DB_PATH \
    .venv/bin/python -m asterism.serve --host 127.0.0.1 --port 8000 \
    --proxy-headers --forwarded-allow-ips=127.0.0.1 &
pids+=("$!")
cd /app/apps/frontend
env -u DB_URL -u MAX_CHARS_FOR_RETRIEVAL -u CORS_ALLOWED_ORIGINS \
    -u DEFAULT_ALLOWED_TOOLS \
    node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3001 &
pids+=("$!")
env -u BETTER_AUTH_SECRET -u SYSTEM_KEY -u ADMIN_PASSPHRASE \
    -u BETTER_AUTH_DB_PATH -u DB_URL \
    nginx -c /app/docker/nginx.conf -g 'daemon off;' &
pids+=("$!")

# A dead service must stop the whole container so restart policies can recover.
status=0
wait -n "${pids[@]}" || status=$?
echo "A service exited (status $status); stopping container" >&2
shutdown
exit 1
