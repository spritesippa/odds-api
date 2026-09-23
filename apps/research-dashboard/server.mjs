// Research dashboard server: serves the static frontend and a small JSON API
// backed by whichever OddsProvider the environment selects. Zero dependencies.
//
//   node server.mjs                      # mock data, no key
//   ODDS_API_KEY=... node server.mjs     # live provider (key stays server-side)

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

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function createDashboardServer(provider) {
  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const url = new URL(req.url, "http://localhost");

      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 200, await handleApi(provider, url));
        return;
      }

      const file = STATIC_FILES[url.pathname];
      if (!file) {
        res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const body = await readFile(join(ROOT, file[0]));
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": file[1], "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error(error);
      sendJson(res, status, { error: status >= 500 && !error.status ? "Internal error" : error.message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const provider = createProvider(process.env);
  const port = Number(process.env.PORT) || 4173;
  const host = process.env.HOST || "127.0.0.1";
  createDashboardServer(provider).listen(port, host, () => {
    console.log(`Research dashboard: http://${host}:${port}`);
    console.log(`Data provider: ${provider.label}${provider.live ? "" : " (no API key, no network calls)"}`);
  });
}

