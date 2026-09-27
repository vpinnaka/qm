#!/usr/bin/env python3
"""OpenAI-compatible shim in front of River's chat_complete_from_checkpoint.

  GET  /v1/models
  POST /v1/chat/completions     (stream: true -> SSE chat.completion.chunk)

Env: RIVER_API_KEY (required), PROXY_API_KEY (required), RIVER_CHECKPOINT
(checkpoint path; if unset, falls back to the base model), RIVER_BASE_MODEL, PORT.

River returns a full OpenAI response body, so non-streaming is mostly pass-through;
streaming is synthesized from the finished completion.
# ponytail: no real token streaming (River's call is non-streaming); swap in its
# streaming API if/when first-token latency matters.
"""
import json, os, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import river_client

ROOT = Path(__file__).resolve().parent
MODEL_ID = "ledgerloop-bookkeeper"
BASE_MODEL = os.environ.get("RIVER_BASE_MODEL", "Qwen/Qwen3.5-9B")
PROXY_KEY = os.environ["PROXY_API_KEY"]
PORT = int(os.environ.get("PORT", 8788))

_ck = os.environ.get("RIVER_CHECKPOINT", "").strip()
if not _ck and (ROOT / "checkpoint.txt").exists():
    _ck = (ROOT / "checkpoint.txt").read_text().strip()
CHECKPOINT = _ck
client = river_client.Client(api_key=os.environ["RIVER_API_KEY"])


def flatten(msg: dict) -> dict:
    """Content parts -> string; tool role -> user text."""
    c = msg.get("content")
    if isinstance(c, list):
        c = "".join(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text")
    elif c is None:
        c = ""
    role = msg.get("role", "user")
    if role == "tool":
        role = "user"
        c = f"[tool result {msg.get('name') or msg.get('tool_call_id') or ''}]\n{c}"
    return {"role": role, "content": c}


def complete(messages, **kw):
    # Training rendered non-thinking targets, so keep thinking off at inference —
    # otherwise Qwen burns the token budget in reasoning_content and returns empty content.
    kw.setdefault("chat_template_kwargs", {"enable_thinking": False})
    if CHECKPOINT:
        return client.chat_complete_from_checkpoint(
            messages, checkpoint_path=CHECKPOINT, base_model=BASE_MODEL, **kw)
    return client.chat_complete(messages, base_model=BASE_MODEL, **kw)


def est_tokens(s: str) -> int:
    return max(1, len(s) // 4)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *a):
        print("%s - %s" % (self.address_string(), fmt % a), flush=True)

    def _send(self, code, obj, ctype="application/json"):
        body = (obj if isinstance(obj, bytes) else json.dumps(obj).encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth(self) -> bool:
        if self.headers.get("Authorization", "") == f"Bearer {PROXY_KEY}":
            return True
        self._send(401, {"error": {"message": "invalid api key", "type": "invalid_request_error"}})
        return False

    def do_GET(self):
        if self.path.rstrip("/") in ("/v1/models", "/models"):
            if not self._auth():
                return
            self._send(200, {"object": "list", "data": [
                {"id": MODEL_ID, "object": "model", "created": 0, "owned_by": "ledgerloop"}]})
        elif self.path.rstrip("/") in ("/health", ""):
            self._send(200, {"ok": True, "checkpoint": bool(CHECKPOINT)})
        else:
            self._send(404, {"error": {"message": "not found"}})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/v1/chat/completions", "/chat/completions"):
            return self._send(404, {"error": {"message": "not found"}})
        if not self._auth():
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception as e:
            return self._send(400, {"error": {"message": f"bad json: {e}"}})

        messages = [flatten(m) for m in req.get("messages", [])]
        if not messages:
            return self._send(400, {"error": {"message": "messages required"}})
        kw = {}
        for src, dst in (("max_tokens", "max_tokens"), ("max_completion_tokens", "max_tokens"),
                         ("temperature", "temperature"), ("top_p", "top_p")):
            if req.get(src) is not None:
                kw[dst] = req[src]
        kw.setdefault("max_tokens", 512)
        stream = bool(req.get("stream"))

        try:
            res = complete(messages, **kw)
            body = json.loads(res.response_json)
            if res.status_code >= 400:
                raise RuntimeError(body)
        except Exception as e:
            print("upstream error:", repr(e)[:500], flush=True)
            return self._send(502, {"error": {"message": f"upstream river error: {e}", "type": "api_error"}})

        body["model"] = MODEL_ID
        prompt_t = est_tokens("".join(m["content"] for m in messages))
        msg = (body.get("choices") or [{}])[0].get("message", {})
        text = msg.get("content") or msg.get("reasoning_content") or ""
        msg["content"] = text
        body.setdefault("usage", {})
        u = body["usage"]
        u.setdefault("prompt_tokens", prompt_t)
        u.setdefault("completion_tokens", est_tokens(text))
        u.setdefault("total_tokens", u["prompt_tokens"] + u["completion_tokens"])

        if not stream:
            return self._send(200, body)
        self._stream(body, text, req)

    def _stream(self, body, text, req):
        cid = body.get("id") or f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = body.get("created") or int(time.time())
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def chunk(delta, finish=None, usage=None, choices=True):
            o = {"id": cid, "object": "chat.completion.chunk", "created": created, "model": MODEL_ID,
                 "choices": ([{"index": 0, "delta": delta, "finish_reason": finish}] if choices else [])}
            if usage is not None:
                o["usage"] = usage
            self.wfile.write(f"data: {json.dumps(o)}\n\n".encode())

        chunk({"role": "assistant", "content": ""})
        step = 64
        for i in range(0, len(text), step) or [0]:
            chunk({"content": text[i:i + step]})
        chunk({}, finish=(body.get("choices") or [{}])[0].get("finish_reason") or "stop")
        if (req.get("stream_options") or {}).get("include_usage"):
            chunk(None, usage=body["usage"], choices=False)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


if __name__ == "__main__":
    print(f"proxy on :{PORT} model={MODEL_ID} checkpoint={'set' if CHECKPOINT else 'NONE (base model fallback)'}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
