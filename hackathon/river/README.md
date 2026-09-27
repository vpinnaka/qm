# LedgerLoop bookkeeper LoRA + OpenAI-compatible proxy

A LoRA (rank 32) trained on River over `Qwen/Qwen3.5-9B`, served behind a tiny
OpenAI-compatible HTTP shim so QM (or anything that speaks the OpenAI chat API)
can use it as a custom provider.

## Pieces

| File | What |
|---|---|
| `build_data.py` | builds `data/train.jsonl` (1800) + `data/eval.jsonl` (50) |
| `train.py` | LoRA SFT on River; logs to `train.log`; writes `checkpoint.txt` |
| `proxy.py` | OpenAI-compatible server on `0.0.0.0:8788` |
| `eval.py` | base vs LoRA accuracy on the held-out 50 (see `EVAL.md`) |

Python: `/home/ubuntu/work/.venv-river/bin/python` (has `river_client`, `transformers`).

## Env

- `RIVER_API_KEY` — from `/home/ubuntu/work/ledgerloop/.env.river` (never commit)
- `PROXY_API_KEY` — bearer token clients must send; generated into `river/.env.proxy` (gitignored)
- `RIVER_CHECKPOINT` — optional; defaults to the contents of `river/checkpoint.txt`.
  If empty, the proxy falls back to the **base model** via `chat_complete`.
- `RIVER_BASE_MODEL` — default `Qwen/Qwen3.5-9B`
- `PORT` — default `8788`

Checkpoint path (this run): see `river/checkpoint.txt`, e.g.
`river://<session-id>/sampler_weights/bookkeeper-v1`.
Model id exposed by the proxy: **`ledgerloop-bookkeeper`**.

## Start

```sh
cd river
set -a; . /home/ubuntu/work/ledgerloop/.env.river; . ./.env.proxy; set +a
nohup /home/ubuntu/work/.venv-river/bin/python proxy.py > proxy.log 2>&1 &
curl -s localhost:8788/health
```

## Endpoints

- `GET /health` — no auth, reports whether a LoRA checkpoint is loaded
- `GET /v1/models` — auth required
- `POST /v1/chat/completions` — auth required; `stream: true` supported.
  `tools` / `tool_choice` / other unknown fields are accepted and ignored.
  Content given as `[{type:"text",text:...}]` parts is flattened; `tool`-role
  messages are flattened into user text. `usage` is always present (estimated
  when upstream omits it).

### curl — non-streaming

```sh
curl -s localhost:8788/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -d '{"model":"ledgerloop-bookkeeper","messages":[
        {"role":"user","content":"Categorize: SHELL OIL 57442 $84.20"}]}'
```

### curl — streaming (SSE)

```sh
curl -sN localhost:8788/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -d '{"model":"ledgerloop-bookkeeper","stream":true,
       "stream_options":{"include_usage":true},
       "messages":[{"role":"user","content":"Categorize: SHELL OIL 57442 $84.20"}]}'
```

Emits `chat.completion.chunk` events (role delta, content deltas, finish chunk
with `finish_reason:"stop"`, optional usage chunk) then `data: [DONE]`.

## Prompt shape the model was trained on

System prompt carries injected per-client context:

```
You are LedgerLoop, a bookkeeping assistant. Be concise and cite the client rule you applied. Flag for review when uncertain.

## Client memory
- Entity: cobalt-freight
- Approved vendor: Western Fuel Network (default GL 6120, prior 0.99)

## Client rules
<coding rules from entities/<client>/rules.md>
```

Assistant replies in the compact house style: `GL <code> — <name>`, `Amount`,
`Confidence`, `Reason` (citing the rule), or `FLAG FOR REVIEW` when the vendor
isn't in memory and no rule covers it. Without client context it falls back to
the public-dataset style: `Category: <x>` + one-line reason.

## Notes / limits

- `create_deployment` is **not** available for this base model on this key
  (`unsupported_topology: no approved unified specification for base model
  Qwen/Qwen3.5-9B`), hence the proxy.
- Thinking is disabled at inference (`chat_template_kwargs={"enable_thinking":false}`)
  to match the non-thinking training targets — without it Qwen spends the whole
  token budget in `reasoning_content` and returns empty `content`.
- Streaming is synthesized from a completed non-streaming River call (~2–9s),
  so there's no real first-token latency win.
