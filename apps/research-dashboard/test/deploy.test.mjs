// Behaviour that matters once the dashboard is public (e.g. on Render):
// password, rate limits, health check, and the live provider end to end.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createDashboardServer } from "../server.mjs";
import { createMockProvider } from "../src/providers/mock-provider.mjs";
import { createProvider } from "../src/providers/index.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const close = (server) => new Promise((resolve) => server.close(resolve));
const basic = (password) => `Basic ${Buffer.from(`me:${password}`).toString("base64")}`;

test("password protects pages and API but not the health check", async () => {
  const server = createDashboardServer(createMockProvider(), { password: "hunter2" });
  const base = await listen(server);
  try {
    const denied = await fetch(`${base}/api/meta`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /^Basic /);
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/api/meta`, { headers: { Authorization: basic("wrong") } })).status, 401);
    assert.equal((await fetch(`${base}/api/meta`, { headers: { Authorization: basic("hunter2") } })).status, 200);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  } finally {
    await close(server);
  }
});

test("API is rate limited per client, using the proxy's last hop when trusted", async () => {
  const server = createDashboardServer(createMockProvider(), { trustProxy: true, rateLimit: { perClient: 3, total: 100, windowMs: 60_000 } });
  const base = await listen(server);
  try {
    const as = (ip) => fetch(`${base}/api/meta`, { headers: { "X-Forwarded-For": `1.1.1.1, ${ip}` } });
    for (let i = 0; i < 3; i++) assert.equal((await as("9.9.9.9")).status, 200);
    const limited = await as("9.9.9.9");
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await as("8.8.8.8")).status, 200, "other clients unaffected");
    assert.equal((await fetch(`${base}/`)).status, 200, "static files aren't counted");
  } finally {
    await close(server);
  }
});

test("a shared ceiling caps total API traffic across clients", async () => {
  const server = createDashboardServer(createMockProvider(), { trustProxy: true, rateLimit: { perClient: 100, total: 4, windowMs: 60_000 } });
  const base = await listen(server);
  try {
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await fetch(`${base}/api/meta`, { headers: { "X-Forwarded-For": `10.0.0.${i}` } })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
  } finally {
    await close(server);
  }
});

test("live mode end to end against a fake odds-api.net", async () => {
  const start = Math.floor(Date.now() / 1000) + 86400;
  const seen = [];
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    seen.push({ path: url.pathname, key: req.headers["x-api-key"], league: url.searchParams.get("league") });
    const json = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/v1/events") {
      const league = url.searchParams.get("league");
      if (league !== "NFL") return json({ items: [], count: 0, next_cursor: null });
      return json({ items: [{ event_id: "nfl-1", sport: "american-football", league: "NFL", start_time: start, home_team: "Buffalo Bills", away_team: "Kansas City Chiefs" }], count: 1 });
    }
    if (url.pathname === "/v1/events/nfl-1/odds/snapshot") {
      const row = (bookmaker, market_key, side, odds, line) => ({
        id: `${bookmaker}:${market_key}:${side}:${line ?? ""}`,
        selection_key: `${market_key}:${side}${line ? `:${line}` : ""}`,
        event_id: "nfl-1", bookmaker, bookmaker_name: bookmaker === "draftkings" ? "DraftKings" : "Pinnacle",
        market_key, period: 0, period_str: "full time", side, odds, line, metric: line ? "points" : undefined, is_available: true
      });
      return json({
        event_id: "nfl-1",
        as_of_ts_ms: Date.now(),
        items: [
          row("pinnacle", "moneyline", "home", 1.62), row("pinnacle", "moneyline", "away", 2.45),
          row("pinnacle", "handicap", "home", 1.95, "-3"), row("pinnacle", "handicap", "away", 1.91, "3"),
          row("pinnacle", "total", "over", 1.92, "46.5"), row("pinnacle", "total", "under", 1.94, "46.5"),
          row("draftkings", "moneyline", "home", 1.6), row("draftkings", "moneyline", "away", 2.4),
          row("draftkings", "handicap", "home", 1.91, "-3"), row("draftkings", "handicap", "away", 1.91, "3"),
          row("draftkings", "total", "over", 1.91, "46.5"), row("draftkings", "total", "under", 1.91, "46.5")
        ]
      });
    }
    if (url.pathname === "/v1/events/nfl-1/odds/history") {
      return json({ series: [{ bookmaker_name: "pinnacle", points: [{ tick_ts: new Date(Date.now() - 86400_000).toISOString(), odds: 1.75 }, { tick_ts: new Date().toISOString(), odds: 1.62 }] }] });
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  const upstreamBase = await listen(upstream);
  const provider = createProvider({ ODDS_API_KEY: "test-key", ODDS_API_BASE_URL: `${upstreamBase}/v1` });
  const server = createDashboardServer(provider, { password: "pw" });
  const base = await listen(server);
  const get = async (path) => {
    const r = await fetch(base + path, { headers: { Authorization: basic("pw") } });
    return { status: r.status, body: await r.json() };
  };
  try {
    const meta = await get("/api/meta");
    assert.equal(meta.body.provider.live, true);
    assert.ok(!JSON.stringify(meta.body).includes("test-key"), "key never reaches the browser");

    const list = await get("/api/events");
    assert.equal(list.status, 200);
    assert.equal(list.body.events.length, 1);
    assert.equal(list.body.events[0].sport, "nfl");
    assert.equal(list.body.events[0].summary.markets.spread.line, -3);

    const detail = await get("/api/events/nfl-1");
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body.markets), ["moneyline", "spread", "total"]);
    assert.equal(detail.body.markets.moneyline.rows.length, 2);
    assert.equal(detail.body.markets.moneyline.best.away.book, "pinnacle");

    const history = await get("/api/events/nfl-1/history?market=moneyline&selection=home");
    assert.equal(history.status, 200);
    assert.equal(history.body.perBook[0].name, "Pinnacle");

    const insights = await get("/api/insights");
    assert.equal(insights.status, 200);
    assert.ok(Array.isArray(insights.body.movers));

    assert.ok(seen.every((call) => call.key === "test-key"), "every upstream call carries the key header");
    const leagues = new Set(seen.filter((c) => c.path === "/v1/events").map((c) => c.league).filter(Boolean));
    assert.deepEqual([...leagues].sort(), ["MLB", "NBA", "NFL", "UFC"]);
  } finally {
    await close(server);
    await close(upstream);
  }
});
