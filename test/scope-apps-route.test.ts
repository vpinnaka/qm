import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { scopeAppRoutes, type ScopeApps } from "../src/api/routes/scope-apps.ts";
import type { ApiCtx } from "../src/api/routes/route.ts";
import type { App } from "../src/api/app.ts";
import type { ServerDeps } from "../src/api/deps.ts";
import { createMemoryMap } from "../src/persistence/durable-map.ts";

const SCOPE = "group:web-project-acme";

function fixture() {
  const scopeApps = createMemoryMap<ScopeApps>();
  const deps: Partial<ServerDeps> = {
    scopeApps,
    admin: {
      listGrants: async () => [{ principalId: "root", role: "org_admin", scopeId: "org:default-org" }],
    } as unknown as ServerDeps["admin"],
  };
  const app = {
    belongsToScope: async (principalId: string, scope: string) => principalId === "alice" && scope === SCOPE,
  } as unknown as App;
  async function invoke(method: string, path: string, body?: unknown, actor: string | null = "alice") {
    let status = 0;
    let text = "";
    const res = {
      setHeader() {},
      writeHead(code: number) {
        status = code;
      },
      end(value: string) {
        text = value;
      },
    } as unknown as ServerResponse;
    const url = new URL(path, "http://localhost");
    const ctx = {
      deps,
      app,
      res,
      url,
      body,
      capability: null,
      actor: actor ? { p: actor, exp: Date.now() + 60_000 } : null,
    } as unknown as ApiCtx;
    const route = scopeAppRoutes.find((r) => "path" in r && r.path === url.pathname && r.method === method)!;
    await route.handle(ctx);
    return { status, data: JSON.parse(text) };
  }
  return { invoke, scopeApps };
}

test("scope apps are readable and writable by members and org admins only", async () => {
  const f = fixture();
  assert.equal((await f.invoke("GET", `/v1/scope-apps?scopeId=${SCOPE}`, undefined, null)).status, 401);
  assert.equal((await f.invoke("GET", `/v1/scope-apps?scopeId=${SCOPE}`, undefined, "bob")).status, 403);
  assert.equal((await f.invoke("GET", "/v1/scope-apps?scopeId=nonsense")).status, 400);
  assert.deepEqual((await f.invoke("GET", `/v1/scope-apps?scopeId=${SCOPE}`)).data, {
    scopeId: SCOPE,
    toolkits: [],
  });
  const saved = await f.invoke("PUT", "/v1/scope-apps", { scopeId: SCOPE, toolkits: ["gmail", "quickbooks", "gmail"] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { scopeId: SCOPE, toolkits: ["gmail", "quickbooks"] });
  assert.deepEqual((await f.invoke("GET", `/v1/scope-apps?scopeId=${SCOPE}`, undefined, "root")).data, {
    scopeId: SCOPE,
    toolkits: ["gmail", "quickbooks"],
  });
  assert.equal((await f.invoke("PUT", "/v1/scope-apps", { scopeId: SCOPE, toolkits: ["Gmail"] })).status, 400);
  assert.equal((await f.invoke("PUT", "/v1/scope-apps", { scopeId: SCOPE, toolkits: "gmail" })).status, 400);
  assert.deepEqual((await f.invoke("PUT", "/v1/scope-apps", { scopeId: SCOPE, toolkits: [] })).data.toolkits, []);
  assert.equal((await f.scopeApps.get(SCOPE))!.updatedBy, "alice");
});
