#!/usr/bin/env bash
# Starts the per-client gbrain memory backend for QM.
# gbrain holds its PGLite datastore in GBRAIN_HOME; the adapter is the only process
# that touches it (single-holder lock), so nothing else runs `gbrain` while this is up.
set -euo pipefail

export GBRAIN_HOME=${GBRAIN_HOME:-/home/ubuntu/work/gbrain-data}
export GBRAIN_CLI=${GBRAIN_CLI:-/home/ubuntu/work/gbrain-src/src/cli.ts}
HERE=$(cd "$(dirname "$0")" && pwd)

set -a
. "$GBRAIN_HOME/.env"
set +a

source ~/.nvm/nvm.sh >/dev/null
nvm use 24.18.0 >/dev/null

pkill -f "gbrain-adapter/server.ts" 2>/dev/null || true
sleep 1
nohup node "$HERE/gbrain-adapter/server.ts" >>"$GBRAIN_HOME/adapter.log" 2>&1 &
sleep 2

curl -sf "http://127.0.0.1:8789/token" -X POST >/dev/null && echo "adapter up on 8789 (log: $GBRAIN_HOME/adapter.log)"

echo "in the QM shell run:"
echo "  export GBRAIN_MCP_CLIENT_ID=qm GBRAIN_MCP_CLIENT_SECRET=local"
echo "  export MEMORY_PROVIDER_CONFIG=\$(node -e 'console.log(JSON.stringify(require(\"$HERE/memory-provider-config.json\")))')"
echo "seed: node $HERE/seed-demo-clients.ts [northwind-scope] [cobalt-scope]"
echo "prove: node $HERE/prove-gbrain-isolation.ts"
