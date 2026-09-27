import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";

const GBRAIN_HOME = process.env.GBRAIN_HOME ?? "/home/ubuntu/work/gbrain-data";
const GBRAIN_CLI = process.env.GBRAIN_CLI ?? "/home/ubuntu/work/gbrain-src/src/cli.ts";
const BUN = process.env.BUN_BIN ?? `${process.env.HOME}/.bun/bin/bun`;
const PORT = Number(process.env.PORT ?? 8789);
const SEED_TOKEN = process.env.GBRAIN_SEED_TOKEN ?? "";

// ponytail: one global mutex because PGLite allows a single process to hold the
// datastore; swap for `gbrain serve --http` + per-source OAuth clients if throughput matters.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

function gb(args: string[]): Promise<{ code: number; out: string }> {
  return serialized(
    () =>
      new Promise((resolve) => {
        const child = spawn(BUN, ["run", GBRAIN_CLI, ...args], {
          env: { ...process.env, GBRAIN_HOME, NO_COLOR: "1" },
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => resolve({ code: code ?? 1, out: out.trim() }));
      }),
  );
}

function sourceOf(scopeId: string): string {
  const bare = scopeId.includes(":") ? scopeId.slice(scopeId.indexOf(":") + 1) : scopeId;
  const slug = bare.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`cannot derive gbrain source from scope ${scopeId}`);
  return slug;
}

const known = new Set<string>();
async function ensureSource(source: string): Promise<void> {
  if (known.has(source)) return;
  const path = `${GBRAIN_HOME}/sources/${source}`;
  mkdirSync(path, { recursive: true });
  const added = await gb(["sources", "add", source, "--path", path, "--no-federated", "--force"]);
  if (added.code !== 0 && !added.out.includes("already")) throw new Error(added.out);
  known.add(source);
}

async function recall(scopeId: string, query: string): Promise<string> {
  const source = sourceOf(scopeId);
  await ensureSource(source);
  const args = ["recall", "--source-id", source, "--limit", "50"];
  if (query) args.push("--query", query);
  const res = await gb(args);
  if (res.code !== 0) throw new Error(res.out);
  return res.out;
}

async function remember(scopeId: string, fact: string, provenance: string): Promise<string> {
  const source = sourceOf(scopeId);
  await ensureSource(source);
  const res = await gb(["remember", fact, "--provenance", provenance, "--source-id", source]);
  if (res.code !== 0) throw new Error(res.out);
  return res.out;
}

const TOOLS = [
  {
    name: "recall",
    description: "Recall this client's remembered facts from gbrain.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, scope: { type: "string" }, acting_user: { type: "string" } },
      required: ["scope"],
    },
  },
  {
    name: "capture",
    description: "Remember new facts about this client in gbrain.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        scope: { type: "string" },
        provenance: { type: "string" },
        acting_user: { type: "string" },
      },
      required: ["content", "scope"],
    },
  },
];

async function callTool(name: string, args: Record<string, string>): Promise<string> {
  if (name === "recall") return await recall(args.scope ?? "", args.query ?? "");
  if (name === "capture") {
    const facts = (args.content ?? "").split("\n").map((f) => f.trim()).filter(Boolean);
    const out: string[] = [];
    for (const fact of facts) out.push(await remember(args.scope ?? "", fact, args.provenance ?? "qm capture"));
    return out.join("\n");
  }
  throw new Error(`unknown tool ${name}`);
}

async function body(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

createServer((req, res) => {
  const json = (status: number, payload: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "POST" && url.pathname === "/token") {
        json(200, { access_token: "gbrain-adapter", token_type: "Bearer", expires_in: 3600 });
        return;
      }
      if (req.method === "POST" && url.pathname === "/mcp") {
        const rpc = JSON.parse(await body(req)) as { id?: unknown; method?: string; params?: Record<string, unknown> };
        if (rpc.method === "tools/list") {
          json(200, { jsonrpc: "2.0", id: rpc.id, result: { tools: TOOLS } });
          return;
        }
        if (rpc.method === "tools/call") {
          const params = (rpc.params ?? {}) as { name?: string; arguments?: Record<string, string> };
          try {
            const text = await callTool(params.name ?? "", params.arguments ?? {});
            json(200, { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text }] } });
          } catch (err) {
            json(200, {
              jsonrpc: "2.0",
              id: rpc.id,
              result: { isError: true, content: [{ type: "text", text: String(err) }] },
            });
          }
          return;
        }
        json(200, { jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: {} } });
        return;
      }

      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!SEED_TOKEN || bearer !== SEED_TOKEN) {
        json(401, { error: "unauthorized" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/clients/seed") {
        const payload = JSON.parse(await body(req)) as { scopeId?: string; clientName?: string; facts?: string[] };
        const scopeId = payload.scopeId ?? "";
        const source = sourceOf(scopeId);
        await ensureSource(source);
        const page = [
          "---",
          `title: ${payload.clientName ?? source} client profile`,
          "---",
          "",
          `# ${payload.clientName ?? source}`,
          "",
          `Scope: ${scopeId}`,
          "",
          ...(payload.facts ?? []).map((f) => `- ${f}`),
          "",
        ].join("\n");
        await gb(["put", `clients/${source}`, "--content", page, "--source-id", source, "--force"]);
        for (const fact of payload.facts ?? []) await remember(scopeId, fact, `seed: ${payload.clientName ?? source}`);
        json(200, { scopeId, source, facts: (payload.facts ?? []).length });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/clients/")) {
        const scopeId = decodeURIComponent(url.pathname.slice("/clients/".length).replace(/\/memories$/, ""));
        json(200, { scopeId, source: sourceOf(scopeId), memories: await recall(scopeId, url.searchParams.get("q") ?? "") });
        return;
      }
      json(404, { error: "not_found" });
    } catch (err) {
      json(500, { error: String(err) });
    }
  })();
}).listen(PORT, "127.0.0.1", () => console.log(`gbrain adapter on http://127.0.0.1:${PORT}`));
