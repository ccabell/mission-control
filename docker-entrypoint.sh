#!/bin/sh
set -e

. /app/scripts/load-env.sh

# A360D-135: restore the verified SQLite online backup once, before the
# application opens its database. Preserve the initial cloud database and WAL.
if [ -f /app/.data/restore-seed.db ]; then
  if [ -e /app/.data/mission-control.db.pre-migration ]; then
    printf '[entrypoint] Refusing repeated database restore\n' >&2
    exit 1
  fi
  for name in mission-control.db mission-control.db-wal mission-control.db-shm; do
    if [ -f "/app/.data/$name" ]; then
      mv "/app/.data/$name" "/app/.data/$name.pre-migration"
    fi
  done
  cp /app/.data/restore-seed.db /app/.data/mission-control.db
  mv /app/.data/restore-seed.db /app/.data/restored-seed.db
  printf '[entrypoint] Restored initial database snapshot\n'
fi

# --- Load .env as literal configuration if present ---
if [ -f /app/.env ]; then
  printf '[entrypoint] Loading .env\n'
  load_env_file /app/.env
fi

# --- Helper: generate a random hex secret ---
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

SECRETS_FILE="/app/.data/.generated-secrets"

# Ensure secrets file has restrictive permissions if it exists
if [ -f "$SECRETS_FILE" ]; then
  chmod 600 "$SECRETS_FILE"
fi

# Load previously generated secrets if they exist
if [ -f "$SECRETS_FILE" ]; then
  printf '[entrypoint] Loading persisted secrets from .data\n'
  load_env_file "$SECRETS_FILE"
fi

# --- AUTH_SECRET ---
if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "random-secret-for-legacy-cookies" ]; then
  AUTH_SECRET=$(generate_secret)
  printf '[entrypoint] Generated new AUTH_SECRET\n'
  printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET" >> "$SECRETS_FILE"
  export AUTH_SECRET
fi

# --- API_KEY ---
if [ -z "$API_KEY" ] || [ "$API_KEY" = "generate-a-random-key" ]; then
  API_KEY=$(generate_secret)
  printf '[entrypoint] Generated new API_KEY\n'
  printf 'API_KEY=%s\n' "$API_KEY" >> "$SECRETS_FILE"
  export API_KEY
fi

printf '[entrypoint] Starting server\n'
exec node server.js
