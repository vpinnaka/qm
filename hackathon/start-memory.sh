#!/usr/bin/env bash
# Starts the per-client gbrain memory adapter for QM, backed by the hosted gbrain MCP.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LOG=${GBRAIN_ADAPTER_LOG:-/tmp/gbrain-adapter.log}

set -a
. "$HOME/.config/gbrain/.env"
set +a

source ~/.nvm/nvm.sh >/dev/null
nvm use 24.18.0 >/dev/null

pkill -f "gbrain-adapter/server.ts" 2>/dev/null || true
sleep 1
nohup node "$HERE/gbrain-adapter/server.ts" >>"$LOG" 2>&1 &
sleep 2

curl -sf "http://127.0.0.1:8789/token" -X POST >/dev/null && echo "adapter up on 8789 (log: $LOG)"

echo "in the QM shell run:"
echo "  export GBRAIN_MCP_CLIENT_ID=qm GBRAIN_MCP_CLIENT_SECRET=local"
echo "  export MEMORY_PROVIDER_CONFIG=\$(node -e 'console.log(JSON.stringify(require(\"$HERE/memory-provider-config.json\")))')"
echo "seed: node $HERE/seed-demo-clients.ts [northwind-scope] [cobalt-scope]"
echo "prove: node $HERE/prove-gbrain-isolation.ts"
