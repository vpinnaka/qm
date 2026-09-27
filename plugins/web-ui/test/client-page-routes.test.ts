import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mintPortalIdentity, PORTAL_IDENTITY_HEADER } from "../../chassis/src/portal-identity.ts";
import { CAPABILITY_HEADER } from "../../chassis/src/core-client.ts";

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown>;
  capability: string;
}

const calls: Call[] = [];
const core = createServer((req: IncomingMessage, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const path = new URL(req.url ?? "/", "http://core").pathname;
    calls.push({
      method: req.method ?? "GET",
      url: req.url ?? "",
      body,
      capability: String(req.headers[CAPABILITY_HEADER] ?? ""),
    });
    res.writeHead(200, { "content-type": "application/json" });
    if (path === "/v1/session-cap") return void res.end(JSON.stringify({ token: "cap-token" }));
    if (path === "/v1/scope-apps")
      return void res.end(JSON.stringify({ scopeId: "group:web-project-p1", toolkits: ["quickbooks"] }));
    res.end(
      JSON.stringify({ servers: [{ id: "quickbooks-ab12", name: "QuickBooks", url: "https://mcp.example.com" }] }),
    );
  });
});
await new Promise<void>((resolve) => core.listen(0, resolve));

process.env.CORE_API_URL = `http://localhost:${(core.address() as AddressInfo).port}`;
process.env.CORE_SIGNING_SECRET = "client-page-web-route-test";
process.env.WEB_UI_PRINCIPALS = "alice";

const { handler } = await import("../server/index.ts");
const surface = createServer((req, res) => void handler(req, res));
await new Promise<void>((resolve) => surface.listen(0, resolve));
const base = `http://localhost:${(surface.address() as AddressInfo).port}`;
const headers = {
  [PORTAL_IDENTITY_HEADER]: mintPortalIdentity({ p: "alice", exp: Date.now() + 60_000 }, "client-page-web-route-test"),
  "content-type": "application/json",
};

test.after(() => {
  surface.close();
  core.close();
});

function since(before: number, pathname: string): Call | undefined {
  return calls.slice(before).find((call) => new URL(call.url, "http://core").pathname === pathname);
}

test("scope apps read and write relay the scope to core", async () => {
  let before = calls.length;
  const read = await fetch(`${base}/api/scope-apps?scopeId=group:web-project-p1`, { headers });
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { scopeId: "group:web-project-p1", toolkits: ["quickbooks"] });
  const relayed = since(before, "/v1/scope-apps");
  assert.equal(relayed?.method, "GET");
  assert.equal(new URL(relayed!.url, "http://core").searchParams.get("scopeId"), "group:web-project-p1");

  before = calls.length;
  const written = await fetch(`${base}/api/scope-apps`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ scopeId: "group:web-project-p1", toolkits: ["quickbooks", "gmail"], sneak: 1 }),
  });
  assert.equal(written.status, 200);
  assert.deepEqual(since(before, "/v1/scope-apps")?.body, {
    scopeId: "group:web-project-p1",
    toolkits: ["quickbooks", "gmail"],
  });

  const bad = await fetch(`${base}/api/scope-apps`, { method: "PUT", headers, body: JSON.stringify({ toolkits: [] }) });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${base}/api/scope-apps`, { headers })).status, 400);
});

test("integration routes reach the admin MCP server API with a session capability", async () => {
  let before = calls.length;
  const list = await fetch(`${base}/api/mcp-servers`, { headers });
  assert.equal(list.status, 200);
  assert.equal(since(before, "/v1/admin/mcp-servers")?.capability, "cap-token");

  before = calls.length;
  const saved = await fetch(`${base}/api/mcp-servers/quickbooks-ab12`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      name: "QuickBooks",
      url: "https://mcp.example.com",
      auth: "none",
      enabled: true,
      validate: true,
      scopes: ["group:web-project-p1"],
    }),
  });
  assert.equal(saved.status, 200);
  const put = since(before, "/v1/admin/mcp-servers/quickbooks-ab12");
  assert.equal(put?.method, "PUT");
  assert.equal(put?.capability, "cap-token");
  assert.deepEqual(put?.body.scopes, ["group:web-project-p1"]);

  before = calls.length;
  const removed = await fetch(`${base}/api/mcp-servers/quickbooks-ab12`, { method: "DELETE", headers });
  assert.equal(removed.status, 200);
  assert.equal(since(before, "/v1/admin/mcp-servers/quickbooks-ab12")?.method, "DELETE");
});
