import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDashboardServer } from "../server.mjs";
import { createMockProvider } from "../src/providers/mock-provider.mjs";

let server;
let base;

before(async () => {
  server = createDashboardServer(createMockProvider());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const getJson = async (path) => {
  const response = await fetch(base + path);
  return { status: response.status, body: await response.json() };
};

test("GET /api/meta reports the mock provider", async () => {
  const { status, body } = await getJson("/api/meta");
  assert.equal(status, 200);
  assert.deepEqual(body.provider, { id: "mock", label: "Mock data", live: false });
  assert.equal(body.sports.length, 5);
  assert.match(body.disclaimer, /guarantee/);
});

test("GET /api/events returns events with summaries and filters by sport", async () => {
  const all = await getJson("/api/events");
  assert.equal(all.status, 200);
  assert.ok(all.body.events.length >= 10);
  assert.ok(all.body.events.every((e) => e.summary && e.summary.bookCount > 0));
  const nba = await getJson("/api/events?sport=nba");
  assert.ok(nba.body.events.length > 0 && nba.body.events.every((e) => e.sport === "nba"));
  assert.equal((await getJson("/api/events?sport=cricket")).status, 400);
});

test("GET /api/events/:id returns analysed markets", async () => {
  const { status, body } = await getJson("/api/events/nfl-kc-buf");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.markets), ["moneyline", "spread", "total"]);
  const ml = body.markets.moneyline;
  const sum = ml.selections.reduce((s, sel) => s + ml.consensus[sel].noVig, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(body.bookSummaries.length, 6);
  assert.equal((await getJson("/api/events/nope")).status, 404);
});

test("GET history validates market and selection", async () => {
  const ok = await getJson("/api/events/nba-bos-nyk/history?market=total&selection=over");
  assert.equal(ok.status, 200);
  assert.ok(ok.body.perBook.length > 0);
  assert.equal((await getJson("/api/events/nba-bos-nyk/history?market=total&selection=home")).status, 400);
  assert.equal((await getJson("/api/events/nba-bos-nyk/history?market=props&selection=over")).status, 400);
});

test("GET /api/insights returns movers, price gaps, and stale books", async () => {
  const { status, body } = await getJson("/api/insights");
  assert.equal(status, 200);
  assert.ok(body.movers.length > 0);
  assert.ok(body.movers.every((m) => m.eventId && m.moves));
  assert.ok(body.gaps.length > 0);
  for (let i = 1; i < body.gaps.length; i++) assert.ok(body.gaps[i - 1].edge >= body.gaps[i].edge);
  assert.ok(body.stale.some((s) => s.eventId === "ufc-hale-volkov" && s.book === "Caesars"));
});

test("event summaries carry headline prices for game cards", async () => {
  const { body } = await getJson("/api/events?sport=soccer");
  const event = body.events[0];
  assert.deepEqual(Object.keys(event.summary.markets.moneyline.selections), ["away", "draw", "home"]);
  const { body: ufc } = await getJson("/api/events?sport=ufc");
  assert.equal(ufc.events[0].summary.markets.spread, undefined);
});

test("static files are allow-listed and carry a CSP", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal((await fetch(`${base}/lib/odds-math.mjs`)).status, 200);
  for (const file of ["app.js", "games.js", "picks.js", "dashboard.js", "settings.js", "store.js", "format.js", "dom.js", "chart.js", "styles.css"]) {
    assert.equal((await fetch(`${base}/${file}`)).status, 200, file);
  }
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/..%2Fserver.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/meta`, { method: "POST" })).status, 405);
});
