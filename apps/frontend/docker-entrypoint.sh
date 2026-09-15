#!/bin/sh
set -eu

: "${BETTER_AUTH_DB_PATH:=${STORAGE_ROOT:-/storage}/users.db}"
export BETTER_AUTH_DB_PATH

# File existence does not imply schema existence. Never reset persistent data.
node --experimental-strip-types migrate-db.mjs

exec node_modules/.bin/next start -H 0.0.0.0 -p 3000
