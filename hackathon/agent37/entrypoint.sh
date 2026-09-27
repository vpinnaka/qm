#!/usr/bin/env bash
# Single-container supervisor: river proxy (8788), gbrain adapter (8789),
# QM core (8080), QM web UI (8000 = the only public port).
# Idempotent: safe to re-run after an image update; only /home/node persists.
set -uo pipefail

APP=/app
STATE=/home/node/qm
LOGS=$STATE/logs
mkdir -p "$STATE/data" "$LOGS"

# Env overrides that survive image updates (agent37 env is create-only).
if [ -f /home/node/qm.env ]; then
  set -a; . /home/node/qm.env; set +a
fi

ORG=${CORE_ORG_ID:-acme}
ADMIN_PRINCIPAL=${ADMIN_PRINCIPAL:-demo@ledgerloop.dev}
MODEL_ID=${RIVER_MODEL_ID:-ledgerloop-bookkeeper}
PUBLIC_URL=${WEB_UI_PUBLIC_URL:-http://localhost:8000}

log() { echo "[entrypoint] $*"; }

# Persisted random secret under /home/node so it survives image updates.
secret() {
  local f=$STATE/$1.secret
  [ -s "$f" ] || { node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))' >"$f"; chmod 600 "$f"; }
  cat "$f"
}

# ---------------------------------------------------------------- river proxy
if [ -n "${RIVER_API_KEY:-}" ] && [ -n "${PROXY_API_KEY:-}" ]; then
  log "starting river proxy on 8788"
  ( cd "$APP/hackathon/river" && PORT=8788 python3 proxy.py ) >>"$LOGS/river.log" 2>&1 &
else
  log "WARN river proxy disabled (RIVER_API_KEY/PROXY_API_KEY unset)"
fi

# ------------------------------------------------------------- gbrain adapter
if [ -n "${GBRAIN_HOSTED_URL:-}" ] && [ -n "${GBRAIN_HOSTED_TOKEN:-}" ]; then
  log "starting gbrain adapter on 8789 (hosted backend)"
  PORT=8789 node "$APP/hackathon/gbrain-adapter/server.ts" >>"$LOGS/gbrain.log" 2>&1 &
else
  log "WARN gbrain adapter disabled (GBRAIN_HOSTED_URL/GBRAIN_HOSTED_TOKEN unset)"
fi

# ----------------------------------------------------------------- postgres
PGDATA=$STATE/pg
if [ -z "${DATABASE_URL:-}" ] && command -v pg_ctl >/dev/null; then
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    log "initdb $PGDATA"
    rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chmod 700 "$PGDATA"
    initdb -D "$PGDATA" -U postgres --auth=trust >>"$LOGS/pg.log" 2>&1
  fi
  PGPASS=$(secret pg)
  pg_ctl -D "$PGDATA" -l "$LOGS/pg.log" -o "-c listen_addresses=127.0.0.1 -p 5432 -k $STATE" -w start >>"$LOGS/pg.log" 2>&1
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 -q && break; sleep 1; done
  psql -h 127.0.0.1 -U postgres -tAc "select 1 from pg_roles where rolname='qm'" | grep -q 1 \
    || psql -h 127.0.0.1 -U postgres -q -c "create role qm login password '$PGPASS'"
  psql -h 127.0.0.1 -U postgres -q -c "alter role qm password '$PGPASS'"
  psql -h 127.0.0.1 -U postgres -tAc "select 1 from pg_database where datname='qm'" | grep -q 1 \
    || psql -h 127.0.0.1 -U postgres -q -c "create database qm owner qm"
  export DATABASE_URL="postgres://qm:$PGPASS@127.0.0.1:5432/qm"
  trap 'pg_ctl -D "$PGDATA" -m fast stop >>"$LOGS/pg.log" 2>&1' EXIT TERM INT
  log "postgres ready at 127.0.0.1:5432/qm"
fi

# ----------------------------------------------------------------- QM core
export ORG_ID=$ORG CORE_ORG_ID=$ORG
export HARNESS=${HARNESS:-pi}
export DATA_DIR=$STATE/data
export ALLOW_UNAUTHENTICATED_CORE=1
export ADMIN_GRANTS=${ADMIN_GRANTS:-$ADMIN_PRINCIPAL:org_admin}
export PUBLIC_WEB_URL=$PUBLIC_URL
if [ -n "${DATABASE_URL:-}" ]; then
  export SESSION_STORE=${SESSION_STORE:-postgres} RUN_STORE=${RUN_STORE:-postgres}
else
  export SESSION_STORE=memory RUN_STORE=memory
  log "WARN no DATABASE_URL: sessions and runs are in-memory (lost on restart)"
fi
export PORTAL_IDENTITY_SECRET=${PORTAL_IDENTITY_SECRET:-$(secret portal-identity)}
export CONNECTOR_SECRET_KEY=${CONNECTOR_SECRET_KEY:-$(secret connector)}
export CAPABILITY_SECRET=${CAPABILITY_SECRET:-$(secret capability)}
export GBRAIN_MCP_CLIENT_ID=${GBRAIN_MCP_CLIENT_ID:-qm}
export GBRAIN_MCP_CLIENT_SECRET=${GBRAIN_MCP_CLIENT_SECRET:-local}
export MEMORY_PROVIDER_CONFIG=${MEMORY_PROVIDER_CONFIG:-$(tr -d ' \n' <"$APP/hackathon/memory-provider-config.json")}
# core's HTTP ingress is unauthenticated, so 8080 must never be published.
unset CORE_SIGNING_SECRET NODE_ENV
if [ -n "${DATABASE_URL:-}" ]; then
  log "applying database migrations"
  ( cd "$APP" && node src/migrate-main.ts ) >>"$LOGS/core.log" 2>&1 || { log "FATAL migrations failed"; tail -30 "$LOGS/core.log"; exit 1; }
fi
log "starting QM core on 8080 (harness=$HARNESS org=$ORG)"
( cd "$APP" && PORT=8080 node src/index.ts ) >>"$LOGS/core.log" 2>&1 &
CORE_PID=$!

for _ in $(seq 1 90); do
  curl -sf http://127.0.0.1:8080/healthz >/dev/null && break
  kill -0 "$CORE_PID" 2>/dev/null || { log "FATAL core exited"; tail -40 "$LOGS/core.log"; exit 1; }
  sleep 1
done

adm() { curl -sS -o /dev/null -w '%{http_code}' -X PUT "http://127.0.0.1:8080$1" \
  -H 'content-type: application/json' -H "x-admin-actor: $ADMIN_PRINCIPAL@$ORG" -d "$2"; }

# --------------------------------------------- register river as the default model
if [ -n "${PROXY_API_KEY:-}" ]; then
  body=$(MODEL_ID=$MODEL_ID node -e 'const m=process.env.MODEL_ID;console.log(JSON.stringify({name:"LedgerLoop River",protocol:"openai",baseUrl:"http://127.0.0.1:8788/v1",apiKey:process.env.PROXY_API_KEY,models:[{id:m,name:"LedgerLoop Bookkeeper (LoRA)",contextWindow:32768,maxTokens:4096}],validate:false}))')
  log "register custom provider river -> $(adm /v1/admin/custom-providers/river "$body")"
  log "org default model $MODEL_ID -> $(adm "/v1/admin/scopes/org:$ORG/runtime" \
    "{\"harnessId\":\"$HARNESS\",\"modelId\":\"$MODEL_ID\",\"effortLevel\":\"auto\",\"fastMode\":false}")"
  log "web UI model picker $MODEL_ID -> $(adm "/v1/admin/scopes/org:$ORG/webui-models" "{\"ids\":[\"$MODEL_ID\"]}")"
fi

# ------------------------------------------------------------------- web UI
export CORE_API_URL=http://127.0.0.1:8080
export WEB_UI_PUBLIC_URL=$PUBLIC_URL
export WEB_UI_BASE=/
export ADMIN_ENABLED=${ADMIN_ENABLED:-1}
export WEB_UI_PRINCIPALS=${WEB_UI_PRINCIPALS:-$ADMIN_PRINCIPAL}
export GBRAIN_SEED_URL=${GBRAIN_SEED_URL:-http://127.0.0.1:8789/clients/seed}
export LOGIN_PASSWORD=${LOGIN_PASSWORD:?LOGIN_PASSWORD must be set (agent37 env or /home/node/qm.env)}
log "starting web UI on 8001"
( cd "$APP/plugins/web-ui" && PORT=8001 node server/index.ts ) &
log "starting login front door on 8000"
env PORT=8000 WEB_UI_PORT=8001 node "$APP/hackathon/agent37/front.ts" &
wait -n
