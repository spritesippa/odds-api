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
const CACHE_TTL_MS = 30_000;
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

/** Group raw OddLine rows into normalized per-book markets. */
export function mapSnapshot(raw, event) {
  const books = new Map();
  for (const line of raw.items || []) {
    if (!line.is_available || !(line.odds > 1) || !isFullGame(line)) continue;
    const market = normalizeMarket(line);
    const selection = normalizeSide(line);
    if (!market || !selection) continue;
    if (market === "total" && !["over", "under"].includes(selection)) continue;
    if (market !== "total" && ["over", "under"].includes(selection)) continue;
    if (market === "spread" && selection === "draw") continue;

    const point = market === "moneyline" ? null : Number.parseFloat(line.line);
    if (market !== "moneyline" && !Number.isFinite(point)) continue;

    const key = line.bookmaker;
    if (!books.has(key)) {
      books.set(key, {
        key,
        name: line.bookmaker_name || key,
        updatedAt: new Date(raw.as_of_ts_ms || Date.now()).toISOString(),
        markets: {},
        selectionKeys: {},
        decimals: {}
      });
    }
    const book = books.get(key);
    const outcomes = (book.markets[market] ||= []);
    // Keep one line per selection; for spreads/totals prefer the main line
    // (the one priced closest to even money).
    const slot = `${market}:${selection}`;
    const existing = outcomes.findIndex((o) => o.selection === selection);
    const outcome = {
      selection,
      name: outcomeName(event, selection, point),
      price: decimalToAmerican(line.odds),
      point
    };
    const closerToEven = existing !== -1 && market !== "moneyline" && Math.abs(line.odds - 2) < Math.abs(book.decimals[slot] - 2);
    if (existing === -1 || closerToEven) {
      if (existing === -1) outcomes.push(outcome);
      else outcomes[existing] = outcome;
      book.selectionKeys[slot] = line.selection_key || line.id;
      book.decimals[slot] = line.odds;
    }
  }
  return {
    eventId: String(raw.event_id),
    asOf: new Date(raw.as_of_ts_ms || Date.now()).toISOString(),
    books: [...books.values()].map(({ decimals, ...book }) => book)
  };
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

  async function request(path, params = {}) {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const cacheKey = url.toString();
    const hit = cache.get(cacheKey);
    if (hit && clock() - hit.at < CACHE_TTL_MS) return hit.value;

    const response = await fetchImpl(url, { headers: { "X-API-Key": options.apiKey, Accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) {
      const error = new Error(`Odds API ${response.status} for ${path}`);
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    const value = await response.json();
    for (const [key, entry] of cache) {
      if (clock() - entry.at >= CACHE_TTL_MS) cache.delete(key);
    }
    cache.set(cacheKey, { at: clock(), value });
    return value;
  }

  async function fetchEvents(sport) {
    // Round to the minute so the request (and its cache key) is stable.
    const nowSec = Math.floor(clock() / 60_000) * 60;
    const data = await request("/events", {
      ...SPORT_FILTERS[sport],
      start_from: nowSec,
      start_to: nowSec + EVENT_WINDOW_DAYS * 86400,
      limit: 25
    });
    const events = (data?.items || []).map((item) => toEvent(item, sport));
    for (const event of events) eventIndex.set(event.id, event);
    return events;
  }

  async function getEvent(eventId) {
    if (eventIndex.has(eventId)) return eventIndex.get(eventId);
    const data = await request(`/events/${encodeURIComponent(eventId)}`);
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
      const source = snapshot?.books.find((book) => book.selectionKeys[`${market}:${selection}`]);
      if (!source) return null;
      const currentPoint = source.markets[market].find((o) => o.selection === selection)?.point ?? null;
      const now = Math.floor(clock() / 60_000) * 60_000;
      const raw = await request(`/events/${encodeURIComponent(eventId)}/odds/history`, {
        selection_key: source.selectionKeys[`${market}:${selection}`],
        from_ts: new Date(now - 3 * 86400_000).toISOString(),
        to_ts: new Date(now).toISOString(),
        limit_points_per_bookmaker: 200
      });
      return {
        eventId,
        market,
        selection,
        series: (raw?.series || []).map((series) => ({
          book: series.bookmaker_name,
          name: series.bookmaker_name,
          points: (series.points || [])
            .filter((p) => p.is_available !== false && p.odds > 1)
            .map((p) => ({ t: new Date(p.tick_ts).toISOString(), price: decimalToAmerican(p.odds), point: currentPoint }))
        }))
      };
    }
  };
}
