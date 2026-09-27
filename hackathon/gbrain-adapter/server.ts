import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8789);
const SEED_TOKEN = process.env.GBRAIN_SEED_TOKEN ?? "";
const HOSTED_URL = process.env.GBRAIN_HOSTED_URL ?? "https://gbrain.io/mcp";
const HOSTED_TOKEN = process.env.GBRAIN_HOSTED_TOKEN ?? "";

function entityOf(scopeId: string): string {
  const bare = scopeId.includes(":") ? scopeId.slice(scopeId.indexOf(":") + 1) : scopeId;
  const slug = bare.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`cannot derive gbrain entity from scope ${scopeId}`);
  return `client-${slug}`;
}

let rpcId = 0;
async function gbrain(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!HOSTED_TOKEN) throw new Error("GBRAIN_HOSTED_TOKEN is not set");
  const res = await fetch(HOSTED_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${HOSTED_TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data:"));
  const rpc = JSON.parse(line ? line.slice(5).trim() : raw) as {
    error?: { message?: string };
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  if (rpc.error) throw new Error(`gbrain ${tool}: ${rpc.error.message ?? "error"}`);
  const text = rpc.result?.content?.[0]?.text ?? "";
  if (rpc.result?.isError) throw new Error(`gbrain ${tool}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

type Fact = { fact?: string; entity_slug?: string };

async function recall(scopeId: string): Promise<string> {
  const entity = entityOf(scopeId);
  const out = await gbrain("recall", { entity, limit: 100 });
  const facts = ((out.facts ?? []) as Fact[]).filter(
    (f) => (f.entity_slug ?? "").split("/").pop() === entity,
  );
  return facts.map((f) => `- ${f.fact ?? ""}`).join("\n");
}

async function remember(scopeId: string, fact: string, provenance: string): Promise<string> {
  const out = await gbrain("remember", {
    entity: entityOf(scopeId),
    fact,
    provenance: `qm:${scopeId} ${provenance}`.slice(0, 500),
    visibility: "world",
  });
  return String(out.status_text ?? "remembered");
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
  if (name === "recall") return await recall(args.scope ?? "");
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
        const entity = entityOf(scopeId);
        const page = [
          "---",
          `title: ${payload.clientName ?? entity} client profile`,
          "---",
          "",
          `# ${payload.clientName ?? entity}`,
          "",
          `Scope: ${scopeId}`,
          "",
          ...(payload.facts ?? []).map((f) => `- ${f}`),
          "",
        ].join("\n");
        await gbrain("put_page", { slug: `clients/${entity}`, content: page });
        const existing = await recall(scopeId);
        let written = 0;
        for (const fact of payload.facts ?? []) {
          if (existing.includes(fact)) continue;
          await remember(scopeId, fact, `seed: ${payload.clientName ?? entity}`);
          written += 1;
        }
        json(200, { scopeId, entity, facts: written });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/clients/")) {
        const scopeId = decodeURIComponent(url.pathname.slice("/clients/".length).replace(/\/memories$/, ""));
        json(200, { scopeId, entity: entityOf(scopeId), memories: await recall(scopeId) });
        return;
      }
      json(404, { error: "not_found" });
    } catch (err) {
      json(500, { error: String(err) });
    }
  })();
}).listen(PORT, "127.0.0.1", () => console.log(`gbrain adapter on http://127.0.0.1:${PORT} (hosted gbrain)`));
