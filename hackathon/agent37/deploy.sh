#!/usr/bin/env bash
# Build the all-in-one QM image on agent37 and point the instance at the new revision.
#
#   hackathon/agent37/deploy.sh build          # cloud-build a new template revision
#   hackathon/agent37/deploy.sh create         # create the instance (once; env is create-only)
#   hackathon/agent37/deploy.sh update         # move the existing instance to the latest revision
#   hackathon/agent37/deploy.sh env            # push /home/node/qm.env overrides to a live instance
#   hackathon/agent37/deploy.sh status | logs
#
# Needs AGENT37_API_KEY (set -a; . ~/.config/agent37/.env; set +a) and, for create/env,
# the secret files listed in SECRET FILES below. Never echoes secret values.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
API=${AGENT37_API_URL:-https://api.agent37.com/v1}
TEMPLATE=${TEMPLATE_NAME:-qm-hackathon}
INSTANCE_NAME=${INSTANCE_NAME:-qm-hackathon}
STATE_FILE=${STATE_FILE:-$HOME/.config/agent37/qm-hackathon.instance}

: "${AGENT37_API_KEY:?set AGENT37_API_KEY}"
a37() { curl -sS -H "Authorization: Bearer $AGENT37_API_KEY" -H 'content-type: application/json' "$@"; }

# SECRET FILES — sourced, never printed.
load_secrets() {
  set -a
  [ -f "${RIVER_ENV:-/home/ubuntu/work/ledgerloop/.env.river}" ] && . "${RIVER_ENV:-/home/ubuntu/work/ledgerloop/.env.river}"
  [ -f "${PROXY_ENV:-/home/ubuntu/.claude/worktrees/river-lora/river/.env.proxy}" ] && . "${PROXY_ENV:-/home/ubuntu/.claude/worktrees/river-lora/river/.env.proxy}"
  [ -f "${GBRAIN_ENV:-$HOME/.config/gbrain/.env}" ] && . "${GBRAIN_ENV:-$HOME/.config/gbrain/.env}"
  [ -f "${GBRAIN_SEED_ENV:-/home/ubuntu/work/gbrain-data/.env}" ] && . "${GBRAIN_SEED_ENV:-/home/ubuntu/work/gbrain-data/.env}"
  set +a
  [ -f "${LOGIN_ENV:-$HOME/.config/agent37/qm-login.env}" ] && { set -a; . "${LOGIN_ENV:-$HOME/.config/agent37/qm-login.env}"; set +a; }
  : "${RIVER_API_KEY:?}" "${PROXY_API_KEY:?}" "${LOGIN_PASSWORD:?generate one into ~/.config/agent37/qm-login.env}"
}

env_json() {
  load_secrets
  node -e '
    const pick = (k) => process.env[k] ?? "";
    console.log(JSON.stringify({
      RIVER_API_KEY: pick("RIVER_API_KEY"),
      PROXY_API_KEY: pick("PROXY_API_KEY"),
      RIVER_CHECKPOINT: pick("RIVER_CHECKPOINT"),
      GBRAIN_HOSTED_URL: process.env.GBRAIN_HOSTED_URL || "https://gbrain.io/mcp",
      GBRAIN_HOSTED_TOKEN: pick("GBRAIN_HOSTED_TOKEN"),
      GBRAIN_SEED_TOKEN: pick("GBRAIN_SEED_TOKEN"),
      ANTHROPIC_API_KEY: pick("ANTHROPIC_API_KEY"),
      ADMIN_PRINCIPAL: process.env.ADMIN_PRINCIPAL || "demo@ledgerloop.dev",
      LOGIN_PASSWORD: pick("LOGIN_PASSWORD"),
      CORE_ORG_ID: "acme",
      HARNESS: "pi",
    }));'
}

instance_id() { [ -f "$STATE_FILE" ] && cat "$STATE_FILE"; }

case "${1:-build}" in
build)
  cd "$ROOT"
  npx -y agent37 templates build . --name "$TEMPLATE" --default-port 8000
  ;;
create)
  [ -n "$(instance_id)" ] && { echo "instance already recorded in $STATE_FILE — use 'update'"; exit 1; }
  rev=${2:?usage: deploy.sh create <template-revision>}
  mkdir -p "$(dirname "$STATE_FILE")"
  body=$(REV="$TEMPLATE@$rev" NAME="$INSTANCE_NAME" ENVJSON="$(env_json)" node -e '
    console.log(JSON.stringify({
      template: process.env.REV, name: process.env.NAME,
      resources: { cpu: 4, memory: 8, disk: 20 },
      env: JSON.parse(process.env.ENVJSON),
      public_ports: [{ port: 8000, prefix: "qm-hackathon" }],
      auto_sleep: false,
    }));')
  out=$(a37 -X POST "$API/instances" -d "$body")
  echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify({id:j.id,status:j.status,urls:j.public_ports??j.urls},null,2))})'
  echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).id??""))' > "$STATE_FILE"
  ;;
update)
  rev=${2:?usage: deploy.sh update <template-revision>}
  a37 -X PATCH "$API/instances/$(instance_id)" -d "{\"template\":\"$TEMPLATE@$rev\"}"
  ;;
env)
  # agent37 env is create-only; the entrypoint also sources /home/node/qm.env.
  lines=$(env_json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Object.entries(j).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join("\n"))})')
  a37 -X POST "$API/instances/$(instance_id)/exec" \
    -d "$(CMD="cat > /home/node/qm.env <<'A37EOF'
$lines
A37EOF" node -e 'console.log(JSON.stringify({command:["bash","-lc",process.env.CMD]}))')" >/dev/null
  echo "wrote /home/node/qm.env (restart the instance to apply)"
  ;;
status) a37 "$API/instances/$(instance_id)" ;;
logs) a37 "$API/instances/$(instance_id)/logs" ;;
*) sed -n '2,12p' "$0"; exit 1 ;;
esac
