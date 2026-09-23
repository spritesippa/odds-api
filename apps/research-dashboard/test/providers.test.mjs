import assert from "node:assert/strict";
import test from "node:test";
import { buildEventView } from "../src/analysis.mjs";
import { createProvider, resolveProviderId } from "../src/providers/index.mjs";
import { createMockProvider } from "../src/providers/mock-provider.mjs";
import { createOddsApiProvider, mapSnapshot } from "../src/providers/odds-api-provider.mjs";
import { SELECTIONS } from "../src/providers/provider.mjs";

const NOW = Date.parse("2026-09-23T12:00:00Z");

test("no key -> mock provider, and it never touches the network", async () => {
  const fetchImpl = () => {
    throw new Error("network call in mock mode");
  };
  const provider = createProvider({}, { fetchImpl });
  assert.equal(provider.id, "mock");
  assert.equal(provider.live, false);
  const events = await provider.listEvents();
  await provider.getOdds(events[0].id);
  await provider.getLineHistory(events[0].id, { market: "moneyline", selection: "home" });
});

test("provider selection from environment", () => {
  assert.equal(resolveProviderId({}), "mock");
  assert.equal(resolveProviderId({ ODDS_API_KEY: "k" }), "odds-api");
  assert.equal(resolveProviderId({ ODDS_API_KEY: "k", ODDS_PROVIDER: "mock" }), "mock");
  assert.throws(() => resolveProviderId({ ODDS_PROVIDER: "odds-api" }), /requires ODDS_API_KEY/);
  assert.throws(() => resolveProviderId({ ODDS_PROVIDER: "scraper" }), /Unknown ODDS_PROVIDER/);
});

test("mock slate covers NFL, NBA, MLB, soccer, and UFC", async () => {
  const provider = createMockProvider({ now: () => NOW });
  const sports = new Set((await provider.listEvents()).map((e) => e.sport));
  assert.deepEqual([...sports].sort(), ["mlb", "nba", "nfl", "soccer", "ufc"]);
  assert.ok((await provider.listEvents({ sport: "ufc" })).every((e) => e.sport === "ufc"));
});

test("mock snapshots are well-formed and deterministic", async () => {
  const provider = createMockProvider({ now: () => NOW });
  for (const event of await provider.listEvents()) {
    const snapshot = await provider.getOdds(event.id);
    assert.deepEqual(snapshot, await provider.getOdds(event.id));
    assert.ok(snapshot.books.length >= 5);
    for (const book of snapshot.books) {
      for (const market of event.markets) {
        const outcomes = book.markets[market];
        assert.ok(outcomes?.length >= 2, `${event.id} ${book.key} ${market}`);
        for (const o of outcomes) {
          assert.ok(SELECTIONS[market].includes(o.selection));
          assert.ok(Math.abs(o.price) >= 100, `bad price ${o.price}`);
          if (market !== "moneyline") assert.equal(typeof o.point, "number");
        }
      }
    }
    const view = buildEventView(event, snapshot);
    for (const market of Object.values(view.markets)) {
      for (const row of market.rows) {
        assert.ok(row.hold > 0 && row.hold < 0.12, `${event.id} ${row.book} hold ${row.hold}`);
      }
    }
  }
});

test("soccer moneyline is three-way; UFC has no spread", async () => {
  const provider = createMockProvider({ now: () => NOW });
  const soccer = await provider.getOdds("epl-ars-liv");
  assert.deepEqual(soccer.books[0].markets.moneyline.map((o) => o.selection), ["away", "draw", "home"]);
  const ufc = await provider.getOdds("ufc-hale-volkov");
  assert.equal(ufc.books[0].markets.spread, undefined);
});

test("line history ends at the current snapshot price", async () => {
  const provider = createMockProvider({ now: () => NOW });
  const snapshot = await provider.getOdds("nfl-kc-buf");
  const history = await provider.getLineHistory("nfl-kc-buf", { market: "spread", selection: "home" });
  for (const series of history.series) {
    const last = series.points[series.points.length - 1];
    const current = snapshot.books.find((b) => b.key === series.book).markets.spread.find((o) => o.selection === "home");
    assert.equal(last.price, current.price);
    assert.equal(last.point, current.point);
    assert.ok(series.points[0].point > last.point, "Bills spread should move toward a bigger favorite");
  }
  assert.equal(await provider.getLineHistory("nfl-kc-buf", { market: "moneyline", selection: "draw" }), null);
});

test("stale books are flagged and excluded from consensus", async () => {
  const provider = createMockProvider({ now: () => NOW });
  const event = await provider.getEvent("ufc-hale-volkov");
  const view = buildEventView(event, await provider.getOdds(event.id));
  const ml = view.markets.moneyline;
  assert.equal(ml.rows.find((r) => r.book === "caesars").stale, true);
  assert.equal(ml.best.away.book, "caesars");
  assert.equal(ml.best.away.stale, true);
  const freshAvg = ml.rows.filter((r) => !r.stale).reduce((s, r) => s + r.outcomes[0].noVig, 0) / 5;
  assert.ok(Math.abs(ml.consensus.away.noVig - freshAvg) < 1e-9);
});

test("odds-api adapter maps snapshot lines into normalized markets", () => {
  const raw = {
    event_id: "123",
    as_of_ts_ms: NOW,
    items: [
      { bookmaker: "bet365", market_key: "moneyline", period: "full time", side: "home", odds: 1.8, is_available: true },
      { bookmaker: "bet365", market_key: "moneyline", period: "full time", side: "away", odds: 2.1, is_available: true },
      { bookmaker: "bet365", market_key: "spread", period: "full time", side: "home", line: "-3.5", odds: 1.95, is_available: true },
      { bookmaker: "bet365", market_key: "spread", period: "full time", side: "home", line: "-7.5", odds: 3.1, is_available: true },
      { bookmaker: "bet365", market_key: "spread", period: "full time", side: "away", line: "3.5", odds: 1.87, is_available: true },
      { bookmaker: "bet365", market_key: "totals", period: "full time", side: "over", line: "44.5", odds: 1.91, is_available: true },
      { bookmaker: "bet365", market_key: "totals", period: "full time", side: "under", line: "44.5", odds: 1.91, is_available: true },
      { bookmaker: "bet365", market_key: "totals", period: "1st half", side: "over", line: "21.5", odds: 1.9, is_available: true },
      { bookmaker: "bet365", market_key: "player_points", period: "full time", side: "over", line: "20.5", odds: 1.9, is_available: true },
      { bookmaker: "bet365", market_key: "moneyline", period: "full time", side: "draw", odds: 9, is_available: false }
    ]
  };
  const event = { home: { name: "Home FC" }, away: { name: "Away FC" } };
  const snapshot = mapSnapshot(raw, event);
  const markets = snapshot.books[0].markets;
  assert.deepEqual(markets.moneyline.map((o) => [o.selection, o.price]), [["home", -125], ["away", 110]]);
  assert.deepEqual(markets.spread.map((o) => [o.selection, o.point]), [["home", -3.5], ["away", 3.5]]);
  assert.deepEqual(markets.total.map((o) => [o.selection, o.point]), [["over", 44.5], ["under", 44.5]]);
  assert.equal(snapshot.books[0].decimals, undefined);
});

test("odds-api adapter keeps the key server-side in a header", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ items: [], count: 0 }), { status: 200 });
  };
  const provider = createOddsApiProvider({ apiKey: "secret-key", fetchImpl, now: () => NOW });
  await provider.listEvents({ sport: "nfl" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers["X-API-Key"], "secret-key");
  assert.ok(!calls[0].url.includes("secret-key"));
  assert.ok(calls[0].url.includes("league=NFL"));
  await provider.listEvents({ sport: "nfl" });
  assert.equal(calls.length, 1, "second call is served from cache");
});

test("odds-api adapter surfaces rate limits as 429", async () => {
  const fetchImpl = async () => new Response("slow down", { status: 429 });
  const provider = createOddsApiProvider({ apiKey: "k", fetchImpl, now: () => NOW });
  await assert.rejects(provider.listEvents({ sport: "nba" }), (error) => error.status === 429);
});
