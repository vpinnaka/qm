import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { mintPortalIdentity, PORTAL_IDENTITY_HEADER } from "../../plugins/chassis/src/portal-identity.ts";

const PORT = Number(process.env.PORT ?? 8000);
const UPSTREAM_PORT = Number(process.env.WEB_UI_PORT ?? 8001);
const SECRET = process.env.PORTAL_IDENTITY_SECRET ?? "";
const PASSWORD = process.env.LOGIN_PASSWORD ?? "";
const PRINCIPALS = (process.env.WEB_UI_PRINCIPALS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const COOKIE = "qmfront";

if (!SECRET) throw new Error("PORTAL_IDENTITY_SECRET is required");
if (!PASSWORD) throw new Error("LOGIN_PASSWORD is required");

function sign(principal: string): string {
  return createHmac("sha256", SECRET).update(`front:${principal}`).digest("hex");
}

function principalFromCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie ?? "";
  const hit = raw.split(";").find((part) => part.trim().startsWith(`${COOKIE}=`));
  if (!hit) return null;
  const [principal, mac] = decodeURIComponent(hit.split("=").slice(1).join("=")).split("|");
  if (!principal || !mac) return null;
  const expected = sign(principal);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return PRINCIPALS.length > 0 && !PRINCIPALS.includes(principal) ? null : principal;
}

function loginPage(res: ServerResponse, status: number, message: string): void {
  const options = PRINCIPALS.map((p) => `<option value="${p}">${p}</option>`).join("");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Sign in</title>
<style>body{font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f1115;color:#e8eaf0}
form{display:grid;gap:12px;width:280px}input,select,button{padding:10px;border-radius:8px;border:1px solid #333;background:#181b22;color:inherit;font:inherit}
button{background:#3b6cf6;border-color:#3b6cf6;cursor:pointer}p{color:#f08080;min-height:1em}</style>
<form method=post action="/signin"><h2>LedgerLoop</h2><p>${message}</p>
${PRINCIPALS.length ? `<select name=user>${options}</select>` : '<input name=user placeholder="you@example.com" required>'}
<input type=password name=password placeholder=Password required><button>Sign in</button></form>`);
}

function proxy(req: IncomingMessage, res: ServerResponse, principal: string): void {
  const token = mintPortalIdentity({ p: principal, exp: Date.now() + 10 * 60_000 }, SECRET);
  const headers = { ...req.headers, host: `127.0.0.1:${UPSTREAM_PORT}`, [PORTAL_IDENTITY_HEADER]: token };
  const upstream = httpRequest(
    { host: "127.0.0.1", port: UPSTREAM_PORT, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(upstream);
}

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/signout") {
    res.writeHead(302, { location: "/signin", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0` });
    return res.end();
  }
  if (path === "/signin" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    return req.on("end", () => {
      const form = new URLSearchParams(body);
      const user = (form.get("user") ?? "").trim();
      const password = form.get("password") ?? "";
      const okUser = user.length > 0 && (PRINCIPALS.length === 0 || PRINCIPALS.includes(user));
      const okPassword =
        password.length === PASSWORD.length && timingSafeEqual(Buffer.from(password), Buffer.from(PASSWORD));
      if (!okUser || !okPassword) return loginPage(res, 401, "Wrong user or password.");
      const value = encodeURIComponent(`${user}|${sign(user)}`);
      res.writeHead(302, {
        location: "/",
        "set-cookie": `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${90 * 24 * 3600}`,
      });
      res.end();
    });
  }
  const principal = principalFromCookie(req);
  if (!principal) return loginPage(res, path === "/signin" ? 200 : 401, "");
  return proxy(req, res, principal);
}).listen(PORT, () => console.log(`[front] listening on :${PORT} -> web-ui :${UPSTREAM_PORT}`));
