import { adminStatusFromGrants } from "../../admin/admin-service.ts";
import { parseScopeId, type ScopeId } from "../../types.ts";
import { sendJson } from "../http.ts";
import type { ServerDeps } from "../deps.ts";
import { audit, isObj } from "./shared.ts";
import type { ApiCtx, Route } from "./route.ts";

export interface ScopeApps {
  scopeId: ScopeId;
  toolkits: string[];
  updatedAt: number;
  updatedBy: string;
}

const TOOLKIT_SLUG = /^[a-z0-9_-]{1,100}$/;
const MAX_TOOLKITS = 200;

export async function scopeToolkits(deps: ServerDeps, scope?: ScopeId): Promise<Set<string> | null> {
  if (!scope) return null;
  const record = await deps.scopeApps?.get(scope);
  return record?.toolkits.length ? new Set(record.toolkits) : null;
}

async function target(ctx: ApiCtx, scope: string): Promise<string | null> {
  const actorId = ctx.capability?.actorId ?? ctx.actor?.p;
  if (!actorId) {
    sendJson(ctx.res, 401, { error: "actor_required" });
    return null;
  }
  if (!scope || parseScopeId(scope).kind === null) {
    sendJson(ctx.res, 400, { error: "bad_request", message: "scopeId required" });
    return null;
  }
  if (!ctx.deps.scopeApps) {
    sendJson(ctx.res, 404, { error: "not_found", message: "not available on this deployment" });
    return null;
  }
  const grants = (await ctx.deps.admin?.listGrants()) ?? [];
  if (!adminStatusFromGrants(grants, actorId).isAdmin && !(await ctx.app.belongsToScope(actorId, scope as ScopeId))) {
    sendJson(ctx.res, 403, { error: "forbidden" });
    return null;
  }
  return actorId;
}

async function getScopeApps(ctx: ApiCtx): Promise<void> {
  const scope = (ctx.url.searchParams.get("scopeId") ?? "").trim();
  if (!(await target(ctx, scope))) return;
  const record = await ctx.deps.scopeApps!.get(scope);
  return sendJson(ctx.res, 200, { scopeId: scope, toolkits: record?.toolkits ?? [] });
}

async function putScopeApps(ctx: ApiCtx): Promise<void> {
  const body = isObj(ctx.body) ? ctx.body : {};
  const scope = typeof body.scopeId === "string" ? body.scopeId.trim() : "";
  const actorId = await target(ctx, scope);
  if (!actorId) return;
  if (!Array.isArray(body.toolkits) || body.toolkits.length > MAX_TOOLKITS)
    return sendJson(ctx.res, 400, {
      error: "bad_request",
      message: `toolkits must be an array of at most ${MAX_TOOLKITS} Composio toolkit slugs`,
    });
  const toolkits: string[] = [];
  for (const entry of body.toolkits) {
    if (typeof entry !== "string" || !TOOLKIT_SLUG.test(entry))
      return sendJson(ctx.res, 400, {
        error: "bad_request",
        message: "toolkit slugs are lowercase letters, digits, hyphens, and underscores",
      });
    if (!toolkits.includes(entry)) toolkits.push(entry);
  }
  await ctx.deps.scopeApps!.put(scope, {
    scopeId: scope as ScopeId,
    toolkits,
    updatedAt: Date.now(),
    updatedBy: actorId,
  });
  audit(ctx.deps, {
    principalId: actorId,
    action: "scope-apps.set",
    resource: toolkits.join(",") || "none",
    scopeLabel: scope as ScopeId,
  });
  return sendJson(ctx.res, 200, { scopeId: scope, toolkits });
}

export const scopeAppRoutes: ReadonlyArray<Route<ApiCtx>> = [
  { method: "GET", path: "/v1/scope-apps", auth: "either", handle: getScopeApps },
  { method: "PUT", path: "/v1/scope-apps", auth: "either", handle: putScopeApps },
];
