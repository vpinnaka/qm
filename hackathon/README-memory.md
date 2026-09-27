# Per-client memory (hosted gbrain)

One hosted gbrain brain (`https://gbrain.io/mcp`); one gbrain **entity** per client, derived
deterministically from the QM scope id: `group:web-project-<id>` -> entity `client-web-project-<id>`
(lowercased, non `[a-z0-9-]` collapsed to `-`). Full-UUID project ids work unchanged. Every
`recall` passes that `entity` — never an unscoped read — and results are filtered client-side on the
returned `entity_slug` (gbrain canonicalizes it to `clients/<entity>`), so one client can never see
another's facts.

QM's MCP memory provider talks to `hackathon/gbrain-adapter/server.ts` (port 8789), which
translates QM's tool contract (`recall`/`capture` with a `scope` argument, OAuth
client-credentials at `/token`) into hosted gbrain `recall` / `remember` / `put_page` calls.
No QM source changes are needed.

## Run

```bash
bash hackathon/start-memory.sh                  # adapter on 127.0.0.1:8789
node hackathon/seed-demo-clients.ts             # Northwind + Cobalt demo clients (idempotent)
node hackathon/prove-gbrain-isolation.ts        # isolation proof through QM's provider code
```

Env (all from `~/.config/gbrain/.env`, sourced by `start-memory.sh`, never committed):

| var | purpose |
| --- | --- |
| `GBRAIN_HOSTED_URL` | hosted gbrain streamable-HTTP MCP endpoint (default `https://gbrain.io/mcp`) |
| `GBRAIN_HOSTED_TOKEN` | bearer token for that endpoint (required) |
| `GBRAIN_SEED_TOKEN` | bearer token for the adapter's own `/clients/*` REST routes |

`MEMORY_PROVIDER_CONFIG` lives in `hackathon/memory-provider-config.json`; export it compacted
plus `GBRAIN_MCP_CLIENT_ID` / `GBRAIN_MCP_CLIENT_SECRET` (any values — the adapter is local-only
and mints a static token).

## Onboarding contract

```
POST http://127.0.0.1:8789/clients/seed
Authorization: Bearer $GBRAIN_SEED_TOKEN
{"scopeId":"group:web-project-<id>","clientName":"Acme Co","facts":["..."]}
-> 200 {"scopeId":"...","entity":"client-web-project-<id>","facts":8}

GET http://127.0.0.1:8789/clients/<url-encoded scopeId>/memories
Authorization: Bearer $GBRAIN_SEED_TOKEN
-> 200 {"scopeId":"...","entity":"...","memories":"- fact\n- fact"}
```

Seeding writes a `clients/<entity>` profile page and one gbrain fact per entry in `facts`, skipping
facts already recalled for that entity, so re-seeding does not duplicate.

## Notes

- `recall` ignores QM's free-text query: the hosted `query` arm searches pages brain-wide, so the
  adapter uses the entity-scoped facts arm only (limit 100) and returns every fact for the client.
- Each tool call is one HTTPS round trip to the hosted brain (~0.3-1s); `capture` of N lines is N calls.
