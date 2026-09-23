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

// Shaped like real OddLine rows (see sdks/typescript/src/mock.ts): spreads
// arrive as "handicap" with one row per alternate line.
const line = (bookmaker, market_key, side, odds, extra = {}) => ({
  id: `${bookmaker}::${market_key}::${side}::${extra.line ?? ""}`,
  selection_key: `${market_key}:${side}${extra.line ? `:${extra.line}` : ""}`,
  bookmaker,
  market_key,
  type: market_key,
  bet_type: market_key,
  period: 0,
  period_str: "full time",
  side,
  odds,
  is_available: true,
  ...extra
});

test("odds-api adapter pairs spread/total sides on the main line", () => {
  const raw = {
    event_id: "123",
    as_of_ts_ms: NOW,
    items: [
      line("pinnacle", "moneyline", "home", 1.8),
      line("pinnacle", "moneyline", "away", 2.1),
      line("pinnacle", "moneyline", "draw", 3.4),
      // main handicap pair, plus an alternate pair and an unpaired row
      line("pinnacle", "handicap", "home", 1.95, { line: "-3.5", metric: "points" }),
      line("pinnacle", "handicap", "away", 1.9, { line: "3.5", metric: "points" }),
      line("pinnacle", "handicap", "home", 3.1, { line: "-7.5", metric: "points" }),
      line("pinnacle", "handicap", "away", 1.35, { line: "7.5", metric: "points" }),
      line("pinnacle", "handicap", "home", 1.6, { line: "-1.5", metric: "points" }),
      // goals total (kept) vs corners total (ignored)
      line("pinnacle", "total", "over", 1.91, { line: "44.5", metric: "points" }),
      line("pinnacle", "total", "under", 1.93, { line: "44.5", metric: "points" }),
      line("pinnacle", "total", "over", 1.5, { line: "41.5", metric: "points" }),
      line("pinnacle", "total", "under", 2.6, { line: "41.5", metric: "points" }),
      line("pinnacle", "total", "over", 1.9, { line: "9.5", metric: "corners" }),
      line("pinnacle", "total", "under", 1.9, { line: "9.5", metric: "corners" }),
      // excluded: other periods, props, unavailable, one-sided books
      line("pinnacle", "total", "over", 1.9, { line: "21.5", period: 1, period_str: "1st half" }),
      line("pinnacle", "player_points", "over", 1.9, { line: "20.5" }),
      line("bet365", "moneyline", "home", 1.85, { is_available: false }),
      line("bet365", "moneyline", "away", 2.05)
    ]
  };
  const event = { home: { name: "Home FC" }, away: { name: "Away FC" } };
  const snapshot = mapSnapshot(raw, event);
  assert.equal(snapshot.books.length, 1, "bet365 has no complete market");
  const { markets, selectionKeys } = snapshot.books[0];
  assert.deepEqual(markets.moneyline.map((o) => [o.selection, o.price]), [["away", 110], ["draw", 240], ["home", -125]]);
  assert.deepEqual(markets.spread.map((o) => [o.selection, o.point]), [["away", 3.5], ["home", -3.5]]);
  assert.deepEqual(markets.total.map((o) => [o.selection, o.point]), [["over", 44.5], ["under", 44.5]]);
  assert.equal(selectionKeys["spread:home"], "handicap:home:-3.5");
  assert.ok(markets.spread.every((o) => !("decimal" in o) && !("key" in o)));

  // The analysis layer accepts the mapped snapshot as-is.
  const view = buildEventView({ id: "123", ...event }, snapshot);
  assert.ok(view.markets.spread.rows[0].hold > 0);
});

test("odds-api adapter builds line history from the sharp book's selection key", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith("/odds/snapshot")) {
      return Response.json({
        event_id: "e1",
        as_of_ts_ms: NOW,
        items: [
          line("draftkings", "handicap", "home", 1.91, { line: "-3", bookmaker_name: "DraftKings" }),
          line("draftkings", "handicap", "away", 1.91, { line: "3", bookmaker_name: "DraftKings" }),
          line("pinnacle", "handicap", "home", 1.95, { line: "-3.5", bookmaker_name: "Pinnacle" }),
          line("pinnacle", "handicap", "away", 1.9, { line: "3.5", bookmaker_name: "Pinnacle" })
        ]
      });
    }
    if (u.pathname.endsWith("/odds/history")) {
      return Response.json({
        series: [
          { bookmaker_name: "pinnacle", points: [
            { tick_ts: "2026-09-23T10:00:00Z", odds: 1.98 },
            { tick_ts: "2026-09-22T10:00:00Z", odds: 2.02 },
            { tick_ts: "2026-09-23T11:00:00Z", odds: 1.5, is_available: false }
          ] },
          { bookmaker_name: "empty", points: [] }
        ]
      });
    }
    if (u.pathname === "/v1/events/e1") return Response.json({ event_id: "e1", league: "NFL", home_team: "Buffalo Bills", away_team: "Kansas City Chiefs", start_time: NOW / 1000 + 3600 });
    return new Response("{}", { status: 404 });
  };
  const provider = createOddsApiProvider({ apiKey: "k", fetchImpl, now: () => NOW });
  const history = await provider.getLineHistory("e1", { market: "spread", selection: "home" });
  const historyCall = calls.find((c) => c.includes("/odds/history"));
  assert.match(historyCall, /selection_key=handicap%3Ahome%3A-3\.5/);
  assert.equal(history.series.length, 1, "empty series dropped");
  assert.equal(history.series[0].name, "Pinnacle");
  assert.deepEqual(history.series[0].points.map((p) => p.price), [102, -102], "sorted by time, unavailable dropped");
  assert.ok(history.series[0].points.every((p) => p.point === -3.5));

  // Repeating the request is served from cache (no new upstream calls).
  const before = calls.length;
  await provider.getLineHistory("e1", { market: "spread", selection: "home" });
  assert.equal(calls.length, before);
});

test("odds-api adapter shares one upstream call between concurrent requests", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    await new Promise((r) => setTimeout(r, 20));
    return Response.json({ items: [], count: 0 });
  };
  const provider = createOddsApiProvider({ apiKey: "k", fetchImpl, now: () => NOW });
  await Promise.all([provider.listEvents({ sport: "mlb" }), provider.listEvents({ sport: "mlb" }), provider.listEvents({ sport: "mlb" })]);
  assert.equal(count, 1);
});

test("odds-api adapter explains a rejected key without leaking it", async () => {
  const fetchImpl = async () => new Response("bad key secret-key", { status: 401 });
  const provider = createOddsApiProvider({ apiKey: "secret-key", fetchImpl, now: () => NOW });
  await assert.rejects(provider.listEvents({ sport: "nfl" }), (error) => {
    assert.match(error.message, /rejected the API key/);
    assert.ok(!error.message.includes("secret-key"));
    return error.status === 502;
  });
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
