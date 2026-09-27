# Per-client memory (gbrain)

One self-hosted gbrain brain; one gbrain **source** per client, derived from the QM scope id
(`group:web-project-northwind` -> source `web-project-northwind`), registered `federated=false`
so recall can never cross clients.

QM's MCP memory provider talks to `hackathon/gbrain-adapter/server.ts` (port 8789), which
translates QM's tool contract (`recall`/`capture` with a `scope` argument, OAuth
client-credentials at `/token`) into gbrain CLI calls against the right source. No QM source
changes are needed.

## Run

```bash
bash hackathon/start-memory.sh                  # adapter on 127.0.0.1:8789
node hackathon/seed-demo-clients.ts             # Northwind + Cobalt demo clients
node hackathon/prove-gbrain-isolation.ts        # isolation proof through QM's provider code
```

`MEMORY_PROVIDER_CONFIG` lives in `hackathon/memory-provider-config.json`; export it compacted
plus `GBRAIN_MCP_CLIENT_ID` / `GBRAIN_MCP_CLIENT_SECRET` (any values — the adapter is local-only
and mints a static token).

## Onboarding contract

```
POST http://127.0.0.1:8789/clients/seed
Authorization: Bearer $GBRAIN_SEED_TOKEN
{"scopeId":"group:web-project-<id>","clientName":"Acme Co","facts":["..."]}
-> 200 {"scopeId":"...","source":"web-project-<id>","facts":8}

GET http://127.0.0.1:8789/clients/<url-encoded scopeId>/memories[?q=fuel]
Authorization: Bearer $GBRAIN_SEED_TOKEN
-> 200 {"scopeId":"...","source":"...","memories":"<text>"}
```

Seeding creates the source if missing, writes a `clients/<source>` profile page and one gbrain
fact per entry in `facts`. `GBRAIN_SEED_TOKEN` lives in `$GBRAIN_HOME/.env` (not committed).
