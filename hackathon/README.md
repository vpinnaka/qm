# QM for bookkeepers (hackathon fork)

A fork of QM for accountants who manage many clients. Each client gets its own workspace, its own memory, and a bookkeeping model fine-tuned on River.

## Demo video

[Watch the demo (3:52)](https://drive.google.com/file/d/19HVbGN0btbGWnPSKpOPnccyErmYKoNFL/view). A copy is in the repo at [demo/ledgerloop-demo.mp4](demo/ledgerloop-demo.mp4).

## What changed

| Area                        | Change                                                                                                                                                                                                                                                                                 | Where                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Client switcher             | A Client menu in the web UI header lists clients (QM web Projects) and switches between them. The active client scopes the chat, sessions and memory.                                                                                                                                  | `plugins/web-ui/src/clients.ts`, `shell.ts`, `sessions.ts`                             |
| Client onboarding           | The "Onboard new client" dialog captures entity, industry and one list of instructions (chart of accounts, vendor rules, close preferences). **Fill demo example** prefills a sample client. It saves the brief as the project's SOUL (`POST /v1/soul`) and seeds the client's memory. | `plugins/web-ui/src/client-brief.ts`, `plugins/web-ui/server/index.ts`                 |
| Client page                 | Each client has its own page at `/clients/<slug>` with its brief, apps, MCP servers, a New chat button and its conversations. Open it from the Client menu. New clients land on it after onboarding.                                                                                   | `plugins/web-ui/src/client-panels.ts`, `contexts.ts`, `deep-link.ts`                   |
| Per-client apps             | Attach connected apps (Gmail, QuickBooks and so on) to a client. A client's chats can only use its attached apps, even in a shared workspace. API: `GET/PUT /v1/scope-apps`.                                                                                                           | `src/api/routes/scope-apps.ts`, `src/api/routes/composio.ts`                           |
| Per-client MCP servers      | Add an MCP server (URL and optional bearer token) to one client. Its tools are listed and callable only in that client's chats. API: `scopes` on `PUT /v1/admin/mcp-servers/:id`.                                                                                                      | `src/mcp/`, `src/api/routes/admin/mcp-servers.ts`, `src/tools/primitives.ts`           |
| Accountant mode             | `ACCOUNTANT_MODE` hides developer screens (crons, loops, webhooks, deploys, skills, keychain, files, memory), the slash menu, and the harness, effort and fast-mode controls. Pi is the default harness. "Projects" are called "Clients". The code stays in place behind the flag.     | `plugins/web-ui/src/shell-state.ts`, `model-picker.ts`, `browse.ts`, `settings.ts`     |
| Loopfour design             | The web UI is restyled to the Loopfour Studio design system, with Loopfour branding and provider logos for connectors.                                                                                                                                                                 | `plugins/web-ui/src/ds*.css`, `plugins/web-ui/index.html`                              |
| Tailored chat               | The greeting and suggestion chips come from the active client's brief.                                                                                                                                                                                                                 | `plugins/web-ui/src/chat.ts`                                                           |
| Finance welcome copy        | The first-run welcome text is rewritten for bookkeeping practices.                                                                                                                                                                                                                     | `plugins/web-ui/src/onboarding-welcome.ts`                                             |
| Per-client memory           | A hosted gbrain adapter gives one gbrain entity per client (`client-<scope>`), so recall can never cross clients. Isolation proof: 7/7 pass.                                                                                                                                           | `hackathon/gbrain-adapter/`, [README-memory.md](README-memory.md)                      |
| Bring your own subscription | Users can connect their own ChatGPT/Codex and Claude subscriptions under Settings → AI access. Org custom models like River stay in the same picker and run on company access.                                                                                                         | `src/api/runtime-config.ts`, `src/core/orchestrator.ts`                                |
| Bookkeeper LoRA             | A rank-32 LoRA on `Qwen/Qwen3.5-9B`, trained on River, served as the OpenAI-compatible model `ledgerloop-bookkeeper`. Eval: 96% vs 78% for the base model.                                                                                                                             | `hackathon/river/`, [river/README.md](river/README.md), [river/EVAL.md](river/EVAL.md) |
| All-in-one image            | One container runs Postgres, the River proxy, the gbrain adapter, QM core, the web UI and a password login front door.                                                                                                                                                                 | `Dockerfile`, `hackathon/agent37/`                                                     |

## Run locally (all-in-one container)

```bash
docker build -t qm-hackathon:local .
```

```bash
. /home/ubuntu/work/ledgerloop/.env.river
```

```bash
docker run -d --name qmtest -p 18000:8000 \
  --env-file ~/.config/agent37/qm-login.env \
  --env-file ~/.config/gbrain/.env \
  --env-file /home/ubuntu/.claude/worktrees/river-lora/river/.env.proxy \
  -e RIVER_API_KEY \
  -e WEB_UI_PUBLIC_URL=http://localhost:18000 \
  qm-hackathon:local
```

Open `http://localhost:18000/signin` and sign in as `demo@ledgerloop.dev` with `LOGIN_PASSWORD`. From a laptop, forward the port first with `ssh -L 18000:localhost:18000 ubuntu@<dev-box>`.

Ports inside the container:

| Port | Service                                                               |
| ---- | --------------------------------------------------------------------- |
| 8000 | Login front door (`hackathon/agent37/front.ts`), the only public port |
| 8001 | QM web UI                                                             |
| 8080 | QM core                                                               |
| 8788 | River proxy (`ledgerloop-bookkeeper`)                                 |
| 8789 | gbrain memory adapter                                                 |

Postgres data lives under `/home/node/qm/pg`, so clients and sessions survive a `docker restart`. Nothing is seeded into gbrain on boot. Clients (and their memory) are created only through the onboarding dialog.

## Secrets

Secrets are env files outside the repo and are never committed:

| File                             | Vars                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `~/.config/agent37/qm-login.env` | `LOGIN_PASSWORD`                                                |
| `~/.config/gbrain/.env`          | `GBRAIN_HOSTED_URL`, `GBRAIN_HOSTED_TOKEN`, `GBRAIN_SEED_TOKEN` |
| `.env.river`                     | `RIVER_API_KEY`                                                 |
| `river/.env.proxy`               | `PROXY_API_KEY`                                                 |
| `~/.config/agent37/.env`         | `AGENT37_API_KEY` (cloud deploy only)                           |

## Demo flow

1. Sign in, open the Client menu and choose **Onboard new client**. Add a vendor rule, for example `Shell / fuel card -> 6120 Fuel`.
2. Ask: "What rules do you follow for this client?"
3. Onboard a second client with different rules. Switch between the two and ask again. Each client answers only from its own memory.
4. Open the client page from the Client menu. Attach an app or add an MCP server there. Only that client's chats can use it.

## agent37 cloud deploy (paused)

`hackathon/agent37/deploy.sh` wraps `build`, `create`, `update`, `env`, `status` and `logs`. The cloud build has not been run yet. agent37 env vars can only be set at instance create, and port 8080 is reserved there, which is why the public port is 8000.

## Known gaps

- The River proxy has no tool calling. Streaming is synthesized from a single completion.
- The LoRA was trained on the demo clients. Accuracy on newly onboarded clients is untested.
- Memory recall returns all of a client's facts, unranked.
- The tailored greeting only appears for accounts that already have sessions.
- Adding an MCP server needs org admin rights. A new server's tools show up from the next chat turn.
