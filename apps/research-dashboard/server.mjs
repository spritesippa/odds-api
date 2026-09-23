// Research dashboard server: serves the static frontend and a small JSON API
// backed by whichever OddsProvider the environment selects. Zero dependencies.
//
//   node server.mjs                      # mock data, no key
//   ODDS_API_KEY=... node server.mjs     # live provider (key stays server-side)

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./src/api.mjs";
import { createProvider } from "./src/providers/index.mjs";

export { DISCLAIMER } from "./src/api.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

// Allow-list built once at startup from the top level of public/ (no
// subdirectories, no dotfiles) plus the shared math module. Request paths are
// only ever looked up in this map, never joined onto the filesystem.
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml"
};
const STATIC_FILES = { "/lib/odds-math.mjs": ["src/lib/odds-math.mjs", CONTENT_TYPES[".mjs"]] };
for (const name of readdirSync(join(ROOT, "public"))) {
  const type = CONTENT_TYPES[extname(name)];
  if (type && !name.startsWith(".")) STATIC_FILES[`/${name}`] = [`public/${name}`, type];
}
STATIC_FILES["/"] = STATIC_FILES["/index.html"];

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

const digest = (text) => createHash("sha256").update(String(text)).digest();

/** HTTP Basic auth check: any username, password must match (constant time). */
function passwordOk(req, password) {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.headers.authorization || "");
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const supplied = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(digest(supplied), digest(password));
}

/**
 * Fixed-window request counter per key, plus one shared ceiling so that no
 * mix of clients can drain the odds provider quota.
 */
function createRateLimiter({ perClient, total, windowMs, now }) {
  const clients = new Map();
  let windowStart = now();
  let totalCount = 0;
  return (key) => {
    const t = now();
    if (t - windowStart >= windowMs) {
      windowStart = t;
      totalCount = 0;
      clients.clear();
    }
    const count = (clients.get(key) || 0) + 1;
    clients.set(key, count);
    totalCount += 1;
    if (count > perClient || totalCount > total) return Math.ceil((windowStart + windowMs - t) / 1000);
    return 0;
  };
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    // Behind a hosting proxy the real client is the last address it appended;
    // earlier entries can be supplied by the client and aren't trusted.
    const hops = String(req.headers["x-forwarded-for"] || "").split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || "unknown";
}

// With a live provider, the heaviest endpoint is shared by everyone for a
// couple of minutes instead of being recomputed per visit.
const SHARED_CACHE_MS = { "/api/insights": 120_000 };

/**
 * @param {import("./src/providers/provider.mjs").OddsProvider} provider
 * @param {{ password?: string, trustProxy?: boolean, rateLimit?: { perClient: number, total: number, windowMs: number }, now?: () => number }} [options]
 */
export function createDashboardServer(provider, options = {}) {
  const now = options.now || Date.now;
  // Limits protect the odds provider quota, so they only apply to live data
  // (or when a test passes explicit limits).
  const limit = provider.live || options.rateLimit ? createRateLimiter({ perClient: 120, total: 600, windowMs: 60_000, ...options.rateLimit, now }) : () => 0;
  const shared = new Map();

  async function api(url) {
    const ttl = provider.live ? SHARED_CACHE_MS[url.pathname] : 0;
    if (!ttl) return handleApi(provider, url);
    const key = url.pathname + url.search;
    const hit = shared.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    const value = await handleApi(provider, url);
    shared.set(key, { at: now(), value });
    return value;
  }

  return createServer(async (req, res) => {
    const headers = { ...SECURITY_HEADERS };
    if (options.trustProxy && req.headers["x-forwarded-proto"] === "https") {
      headers["Strict-Transport-Security"] = "max-age=31536000";
    }
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...headers, Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const url = new URL(req.url, "http://localhost");

      // Health check for the host; never touches the odds provider.
      if (url.pathname === "/healthz") {
        res.writeHead(200, { ...headers, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("ok");
        return;
      }

      if (options.password && !passwordOk(req, options.password)) {
        res.writeHead(401, {
          ...headers,
          "WWW-Authenticate": 'Basic realm="Odds Research Dashboard", charset="UTF-8"',
          "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("Password required");
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const retryAfter = limit(clientIp(req, options.trustProxy));
        if (retryAfter) {
          res.writeHead(429, { ...headers, "Content-Type": "application/json; charset=utf-8", "Retry-After": String(retryAfter) });
          res.end(JSON.stringify({ error: "Too many requests. Wait a minute and try again." }));
          return;
        }
        const body = JSON.stringify(await api(url));
        res.writeHead(200, { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(body);
        return;
      }

      const file = STATIC_FILES[url.pathname];
      if (!file) {
        res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const body = await readFile(join(ROOT, file[0]));
      res.writeHead(200, { ...headers, "Content-Type": file[1], "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      const status = error.status || 500;
      // Expected upstream failures get one log line; unexpected ones a stack.
      if (status >= 500) console.error(error.status ? `API error ${error.status}: ${error.message}` : error);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: status >= 500 && !error.status ? "Internal error" : error.message }));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const provider = createProvider(process.env);
  const port = Number(process.env.PORT) || 4173;
  const host = process.env.HOST || "127.0.0.1";
  const password = process.env.DASHBOARD_PASSWORD || "";
  const trustProxy = process.env.TRUST_PROXY === "1";
  createDashboardServer(provider, { password, trustProxy }).listen(port, host, () => {
    console.log(`Research dashboard: http://${host}:${port}`);
    console.log(`Data provider: ${provider.label}${provider.live ? "" : " (no API key, no network calls)"}`);
    console.log(password ? "Password protection: on" : "Password protection: off (set DASHBOARD_PASSWORD to require one)");
    if (provider.live && !password && host !== "127.0.0.1") {
      console.warn("Warning: live data is public without DASHBOARD_PASSWORD; anyone with the URL can use your API quota.");
    }
  });
}

