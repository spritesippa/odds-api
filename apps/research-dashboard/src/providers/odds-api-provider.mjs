// Live OddsProvider for the Odds API (https://api.odds-api.net/v1), mapped to
// the dashboard's normalized shapes. It is only constructed when
// ODDS_API_KEY is set (see ./index.mjs); with no key the dashboard never
// makes a network request. The key stays on the server: it is sent as the
// X-API-Key header and is never returned to the browser.
//
// Market and side names are normalized defensively because bookmakers label
// markets differently. Verify the mapping against real responses before
// relying on it, and extend `normalizeMarket` if a market shows up empty.

import { decimalToAmerican } from "../lib/odds-math.mjs";
import { SPORTS } from "./provider.mjs";

const DEFAULT_BASE_URL = "https://api.odds-api.net/v1";
// Cache lifetimes by endpoint: long enough that a public page can't burn the
// API quota, short enough that prices stay fresh. Identical requests that
// arrive while one is in flight share it.
const TTL_MS = { events: 60_000, event: 300_000, snapshot: 30_000, history: 120_000 };
const REQUEST_TIMEOUT_MS = 15_000;
const EVENT_WINDOW_DAYS = 7;

// How each dashboard sport maps to /events filters. League names come from
// the public coverage list; adjust if /leagues reports different labels.
const SPORT_FILTERS = {
  nfl: { league: "NFL" },
  nba: { league: "NBA" },
  mlb: { league: "MLB" },
  soccer: { sport: "soccer" },
  ufc: { league: "UFC" }
};

export function normalizeMarket(line) {
  const label = `${line.market_key || ""} ${line.bet_type || ""} ${line.type || ""}`.toLowerCase();
  if (/player|prop|team[ _-]?total/.test(label)) return null;
  if (/moneyline|money line|h2h|1x2|match[ _-]?(winner|result)|head[ _-]?to[ _-]?head/.test(label)) return "moneyline";
  if (/spread|handicap|run[ _-]?line|puck[ _-]?line|line/.test(label) && !/total/.test(label)) return "spread";
  if (/total|over[ _/-]?under|o\/u/.test(label)) return "total";
  return null;
}

function normalizeSide(line) {
  const side = `${line.side || ""}`.toLowerCase();
  if (["home", "away", "draw", "over", "under"].includes(side)) return side;
  if (side === "1") return "home";
  if (side === "2") return "away";
  if (side === "x") return "draw";
  return null;
}

function isFullGame(line) {
  const period = `${line.period_str ?? line.period ?? ""}`.toLowerCase();
  return ["", "0", "full time", "full_time", "ft", "game", "match", "fight"].includes(period);
}

function sportKeyFor(summary) {
  const league = `${summary.league || ""}`.toUpperCase();
  const sport = `${summary.sport || ""}`.toLowerCase();
  if (league === "NFL") return "nfl";
  if (league === "NBA") return "nba";
  if (league === "MLB") return "mlb";
  if (league.includes("UFC") || sport.includes("mma")) return "ufc";
  if (sport.includes("soccer") || sport.includes("football-association")) return "soccer";
  return null;
}

function shortName(name) {
  const words = `${name || ""}`.trim().split(/\s+/);
  return words[words.length - 1] || "";
}

function toEvent(summary, sportHint) {
  const sport = sportHint || sportKeyFor(summary);
  const home = summary.home_team || "Home";
  const away = summary.away_team || "Away";
  return {
    id: String(summary.event_id),
    sport,
    league: summary.league || "",
    startTime: new Date((summary.start_time || 0) * 1000).toISOString(),
    home: { name: home, short: shortName(home) },
    away: { name: away, short: shortName(away) },
    neutral: sport === "ufc",
    venue: "",
    markets: sport === "ufc" ? ["moneyline", "total"] : ["moneyline", "spread", "total"],
    notes: []
  };
}

function outcomeName(event, selection, point) {
  if (selection === "over") return `Over ${point}`;
  if (selection === "under") return `Under ${point}`;
  if (selection === "draw") return "Draw";
  return event ? event[selection].name : selection;
}

// Spreads/totals must count the game's main scoring unit, not side markets
// such as corners or cards that share the "total" market key.
const MAIN_METRICS = new Set(["", "points", "goals", "runs", "rounds", "score"]);
const PAIRS = { spread: ["away", "home"], total: ["over", "under"] };
const ORDER = { moneyline: ["away", "draw", "home"], spread: ["away", "home"], total: ["over", "under"] };

/**
 * Group raw OddLine rows into normalized per-book markets.
 * Moneyline keeps each side. Spreads and totals come as many alternate
 * lines, so both sides are paired on the same line (home -3.5 with away
 * +3.5; over 44.5 with under 44.5) and the main line is the complete pair
 * priced closest to even money.
 */
export function mapSnapshot(raw, event) {
  const books = new Map();
  for (const line of raw.items || []) {
    if (line.is_available === false || !(line.odds > 1) || !isFullGame(line)) continue;
    const market = normalizeMarket(line);
    const selection = normalizeSide(line);
    if (!market || !selection || !ORDER[market].includes(selection)) continue;
    if (market !== "moneyline" && !MAIN_METRICS.has(String(line.metric ?? "").toLowerCase())) continue;

    const point = market === "moneyline" ? null : Number.parseFloat(line.line);
    if (market !== "moneyline" && !Number.isFinite(point)) continue;

    if (!books.has(line.bookmaker)) {
      books.set(line.bookmaker, { name: line.bookmaker_name || line.bookmaker, moneyline: {}, spread: new Map(), total: new Map() });
    }
    const book = books.get(line.bookmaker);
    const outcome = {
      selection,
      name: outcomeName(event, selection, point),
      price: decimalToAmerican(line.odds),
      point,
      decimal: line.odds,
      key: line.selection_key || line.id
    };
    if (market === "moneyline") {
      book.moneyline[selection] = outcome;
    } else {
      // Key both sides of a spread by the home team's line so they pair up.
      const lineKey = market === "spread" ? (selection === "home" ? point : -point) : point;
      if (!book[market].has(lineKey)) book[market].set(lineKey, {});
      book[market].get(lineKey)[selection] = outcome;
    }
  }

  const asOf = new Date(raw.as_of_ts_ms || Date.now()).toISOString();
  const out = [];
  for (const [key, book] of books) {
    const markets = {};
    const selectionKeys = {};
    const take = (market, outcomes) => {
      markets[market] = ORDER[market].map((s) => outcomes[s]).filter(Boolean).map(({ decimal, key: k, ...o }) => o);
      for (const o of Object.values(outcomes)) selectionKeys[`${market}:${o.selection}`] = o.key;
    };
    const sides = Object.keys(book.moneyline);
    if (sides.includes("home") && sides.includes("away")) take("moneyline", book.moneyline);
    for (const market of ["spread", "total"]) {
      const [a, b] = PAIRS[market];
      let main = null;
      for (const pair of book[market].values()) {
        if (!pair[a] || !pair[b]) continue;
        const balance = Math.abs(pair[a].decimal - pair[b].decimal);
        if (!main || balance < main.balance) main = { pair, balance };
      }
      if (main) take(market, main.pair);
    }
    if (Object.keys(markets).length) out.push({ key, name: book.name, updatedAt: asOf, markets, selectionKeys });
  }
  return { eventId: String(raw.event_id), asOf, books: out };
}

/**
 * @param {{ apiKey: string, baseUrl?: string, fetchImpl?: typeof fetch, now?: () => number }} options
 * @returns {import("./provider.mjs").OddsProvider}
 */
export function createOddsApiProvider(options) {
  if (!options?.apiKey) throw new Error("createOddsApiProvider requires an apiKey");
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = options.now || Date.now;
  const cache = new Map();
  const eventIndex = new Map();

  const inflight = new Map();

  async function request(path, params = {}, ttl = TTL_MS.snapshot) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const cacheKey = url.toString();
    const hit = cache.get(cacheKey);
    if (hit && clock() - hit.at < hit.ttl) return hit.value;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const pending = (async () => {
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { "X-API-Key": options.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch (cause) {
        const error = new Error("Couldn't reach the odds provider. Try again shortly.");
        error.status = 502;
        error.cause = cause;
        throw error;
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        // Never echo the key or the full upstream body back to the browser.
        const messages = {
          401: "The odds provider rejected the API key. Check ODDS_API_KEY on the server.",
          403: "The API key isn't allowed to use this data. Check your odds-api.net plan.",
          429: "Odds provider rate limit reached. Prices will load again shortly."
        };
        const error = new Error(messages[response.status] || `Odds provider error (${response.status}).`);
        error.status = response.status === 429 ? 429 : 502;
        throw error;
      }
      const value = await response.json();
      const now = clock();
      for (const [key, entry] of cache) {
        if (now - entry.at >= entry.ttl) cache.delete(key);
      }
      cache.set(cacheKey, { at: now, ttl, value });
      return value;
    })();
    inflight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function fetchEvents(sport) {
    // Round to the minute so the request (and its cache key) is stable.
    const nowSec = Math.floor(clock() / 60_000) * 60;
    const data = await request("/events", {
      ...SPORT_FILTERS[sport],
      start_from: nowSec,
      start_to: nowSec + EVENT_WINDOW_DAYS * 86400,
      limit: 25
    }, TTL_MS.events);
    const events = (data?.items || []).map((item) => toEvent(item, sport));
    for (const event of events) eventIndex.set(event.id, event);
    return events;
  }

  async function getEvent(eventId) {
    if (eventIndex.has(eventId)) return eventIndex.get(eventId);
    const data = await request(`/events/${encodeURIComponent(eventId)}`, {}, TTL_MS.event);
    if (!data) return null;
    const event = toEvent(data);
    if (!event.sport) return null;
    eventIndex.set(event.id, event);
    return event;
  }

  async function getSnapshot(eventId) {
    const event = await getEvent(eventId);
    const raw = await request(`/events/${encodeURIComponent(eventId)}/odds/snapshot`, { limit: 2000 });
    return raw ? mapSnapshot(raw, event) : null;
  }

  return {
    id: "odds-api",
    label: "Odds API (live)",
    live: true,

    async listSports() {
      return SPORTS.map((sport) => ({ ...sport }));
    },

    async listEvents(query = {}) {
      const sports = query.sport ? [query.sport] : Object.keys(SPORT_FILTERS);
      const lists = await Promise.all(sports.map(fetchEvents));
      return lists.flat().sort((a, b) => a.startTime.localeCompare(b.startTime));
    },

    getEvent,

    async getOdds(eventId) {
      const snapshot = await getSnapshot(eventId);
      if (!snapshot) return null;
      return { ...snapshot, books: snapshot.books.map(({ selectionKeys, ...book }) => book) };
    },

    async getLineHistory(eventId, { market, selection }) {
      const snapshot = await getSnapshot(eventId);
      // Follow the sharp book's line when it has one; other books' prices
      // for that same selection key come back alongside it.
      const withKey = (snapshot?.books || []).filter((book) => book.selectionKeys[`${market}:${selection}`]);
      const source = withKey.find((book) => book.key === "pinnacle") || withKey[0];
      if (!source) return null;
      const currentPoint = source.markets[market]?.find((o) => o.selection === selection)?.point ?? null;
      // A 5-minute grid keeps the request (and its cache entry) stable.
      const now = Math.floor(clock() / 300_000) * 300_000;
      const bookNames = new Map(snapshot.books.map((b) => [b.key, b.name]));
      const raw = await request(`/events/${encodeURIComponent(eventId)}/odds/history`, {
        selection_key: source.selectionKeys[`${market}:${selection}`],
        from_ts: new Date(now - 3 * 86400_000).toISOString(),
        to_ts: new Date(now).toISOString(),
        limit_points_per_bookmaker: 200
      }, TTL_MS.history);
      return {
        eventId,
        market,
        selection,
        series: (raw?.series || [])
          .map((series) => ({
            book: series.bookmaker_name,
            name: bookNames.get(series.bookmaker_name) || series.bookmaker_name,
            points: (series.points || [])
              .filter((p) => p.is_available !== false && p.odds > 1 && !Number.isNaN(Date.parse(p.tick_ts)))
              .map((p) => ({ t: new Date(p.tick_ts).toISOString(), price: decimalToAmerican(p.odds), point: currentPoint }))
              .sort((a, b) => a.t.localeCompare(b.t))
          }))
          .filter((series) => series.points.length > 0)
      };
    }
  };
}
