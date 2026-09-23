// Research dashboard server: serves the static frontend and a small JSON API
// backed by whichever OddsProvider the environment selects. Zero dependencies.
//
//   node server.mjs                      # mock data, no key
//   ODDS_API_KEY=... node server.mjs     # live provider (key stays server-side)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEventSummary, buildEventView, summarizeHistory } from "./src/analysis.mjs";
import { createProvider } from "./src/providers/index.mjs";
import { MARKETS, SELECTIONS, SPORTS } from "./src/providers/provider.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

// The event list fetches one odds snapshot per event for its summary line.
// Cap it so a live provider isn't hit with hundreds of requests per page load.
const MAX_LIST_SUMMARIES = 30;

// Explicit allow-list: nothing outside these files is ever served.
const STATIC_FILES = {
  "/": ["public/index.html", "text/html; charset=utf-8"],
  "/index.html": ["public/index.html", "text/html; charset=utf-8"],
  "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
  "/chart.js": ["public/chart.js", "text/javascript; charset=utf-8"],
  "/dom.js": ["public/dom.js", "text/javascript; charset=utf-8"],
  "/picks.js": ["public/picks.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
  "/lib/odds-math.mjs": ["src/lib/odds-math.mjs", "text/javascript; charset=utf-8"]
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

export const DISCLAIMER =
  "Research tool only. Prices can be stale, markets can suspend, bets can void, limits apply, and availability depends on your jurisdiction. Nothing here is a guarantee of profit.";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleApi(provider, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"

  if (parts.length === 1 && parts[0] === "meta") {
    return {
      provider: { id: provider.id, label: provider.label, live: provider.live },
      sports: await provider.listSports(),
      markets: MARKETS,
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString()
    };
  }

  if (parts[0] !== "events") throw new HttpError(404, "Not found");

  if (parts.length === 1) {
    const sport = url.searchParams.get("sport") || undefined;
    if (sport && !SPORTS.some((s) => s.key === sport)) throw new HttpError(400, `Unknown sport "${sport}"`);
    const events = await provider.listEvents({ sport });
    const withSummaries = await Promise.all(
      events.map(async (event, index) => {
        if (index >= MAX_LIST_SUMMARIES) return { ...event, summary: null };
        const snapshot = await provider.getOdds(event.id);
        return { ...event, summary: snapshot ? buildEventSummary(event, snapshot) : null };
      })
    );
    return { events: withSummaries, generatedAt: new Date().toISOString() };
  }

  const eventId = decodeURIComponent(parts[1]);
  const event = await provider.getEvent(eventId);
  if (!event) throw new HttpError(404, "Event not found");

  if (parts.length === 2) {
    const snapshot = await provider.getOdds(eventId);
    if (!snapshot) throw new HttpError(404, "No odds for event");
    return buildEventView(event, snapshot);
  }

  if (parts.length === 3 && parts[2] === "history") {
    const market = url.searchParams.get("market");
    const selection = url.searchParams.get("selection");
    if (!MARKETS.includes(market)) throw new HttpError(400, "market must be moneyline, spread, or total");
    if (!SELECTIONS[market].includes(selection)) throw new HttpError(400, `Invalid selection for ${market}`);
    const history = await provider.getLineHistory(eventId, { market, selection });
    if (!history) throw new HttpError(404, "No line history for selection");
    return summarizeHistory(history);
  }

  throw new HttpError(404, "Not found");
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

