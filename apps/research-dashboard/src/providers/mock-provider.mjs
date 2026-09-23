// Mock OddsProvider: deterministic, offline, no API key. Prices are generated
// from the fair lines in ../data/mock-events.mjs so every sportsbook, every
// history point, and the current snapshot agree with one another.

import { MOCK_BOOKS, MOCK_EVENTS, SPORT_PROFILES } from "../data/mock-events.mjs";
import { probabilityToAmerican } from "../lib/odds-math.mjs";
import { SPORTS, SELECTIONS } from "./provider.mjs";

const HISTORY_TICKS = 24;
const TIME_GRID_MS = 5 * 60 * 1000;

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic value in [-1, 1) for a string seed. */
function seeded(seed) {
  let t = (hashString(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
}

const lerp = (a, b, f) => a + (b - a) * f;
const roundHalf = (value) => Math.round(value * 2) / 2;

function marketsFor(spec) {
  return ["moneyline", "spread", "total"].filter((market) => spec[market]);
}

function selectionName(spec, market, selection, point) {
  if (market === "total") return `${selection === "over" ? "Over" : "Under"} ${point}`;
  if (selection === "draw") return "Draw";
  return spec[selection].name;
}

/** The fair (no-vig) state of an event at a movement progress in [0, 1]. */
function fairState(spec, progress) {
  const state = {};
  if (spec.moneyline) {
    const { open, current } = spec.moneyline;
    state.moneyline = {
      home: lerp(open.home, current.home, progress),
      draw: open.draw === undefined ? null : lerp(open.draw, current.draw, progress)
    };
  }
  for (const market of ["spread", "total"]) {
    if (!spec[market]) continue;
    const { open, current } = spec[market];
    const probKey = market === "spread" ? "homeProb" : "overProb";
    state[market] = {
      point: roundHalf(lerp(open.point, current.point, progress)),
      prob: lerp(open[probKey] ?? 0.5, current[probKey] ?? 0.5, progress)
    };
  }
  return state;
}

/** Apply a book's margin and a small per-book shading to fair probabilities. */
function priceMarket(fairProbs, book, vig, seedBase) {
  const jitter = fairProbs.map((_, i) => seeded(`${seedBase}:${i}`) * book.shade);
  const meanJitter = jitter.reduce((a, b) => a + b, 0) / jitter.length;
  return fairProbs.map((p, i) => {
    const shaded = Math.min(0.97, Math.max(0.03, p + jitter[i] - meanJitter));
    return probabilityToAmerican(shaded * (1 + vig), book.step);
  });
}

function bookOffset(spec, book, market) {
  if (!SPORT_PROFILES[spec.sport].offsets || book.key === "pinnacle") return 0;
  const roll = seeded(`${spec.id}:${book.key}:${market}:offset`);
  if (roll > 0.8) return 0.5;
  if (roll < -0.8) return -0.5;
  return 0;
}

function priceBook(spec, book, state) {
  const profile = SPORT_PROFILES[spec.sport];
  const vig = book.vig * profile.vigScale;
  const markets = {};

  if (state.moneyline) {
    const { home, draw } = state.moneyline;
    const selections = draw === null ? ["away", "home"] : ["away", "draw", "home"];
    const probs = draw === null ? [1 - home, home] : [1 - home - draw, draw, home];
    const prices = priceMarket(probs, book, vig, `${spec.id}:${book.key}:moneyline`);
    markets.moneyline = selections.map((selection, i) => ({
      selection,
      name: selectionName(spec, "moneyline", selection),
      price: prices[i],
      point: null
    }));
  }

  if (state.spread) {
    const offset = bookOffset(spec, book, "spread");
    const homePoint = state.spread.point + offset;
    const homeProb = state.spread.prob + offset * profile.spreadPerPoint;
    const [awayPrice, homePrice] = priceMarket([1 - homeProb, homeProb], book, vig, `${spec.id}:${book.key}:spread`);
    markets.spread = [
      { selection: "away", name: spec.away.name, price: awayPrice, point: -homePoint || 0 },
      { selection: "home", name: spec.home.name, price: homePrice, point: homePoint }
    ];
  }

  if (state.total) {
    const offset = bookOffset(spec, book, "total");
    const point = state.total.point + offset;
    const overProb = state.total.prob - offset * profile.totalPerPoint;
    const [overPrice, underPrice] = priceMarket([overProb, 1 - overProb], book, vig, `${spec.id}:${book.key}:total`);
    markets.total = [
      { selection: "over", name: selectionName(spec, "total", "over", point), price: overPrice, point },
      { selection: "under", name: selectionName(spec, "total", "under", point), price: underPrice, point }
    ];
  }

  return markets;
}

// Typical start slots in UTC (US Eastern in September is UTC-4), so mock
// games land at believable local times instead of "now + N hours".
const KICKOFF_UTC = {
  nfl: [17, 0], // 1:00 PM ET
  nba: [23, 30], // 7:30 PM ET
  mlb: [23, 5], // 7:05 PM ET
  soccer: [14, 0], // 3:00 PM UK
  ufc: [2, 0] // 10:00 PM ET main card
};

/** Start time: the sport's usual slot on the day `startsInHours` lands on. */
function kickoffTime(spec, now) {
  const [hour, minute] = spec.kickoffUtc || KICKOFF_UTC[spec.sport];
  const date = new Date(now + spec.startsInHours * 3600_000);
  date.setUTCHours(hour, minute, 0, 0);
  if (date.getTime() < now + 2 * 3600_000) date.setUTCDate(date.getUTCDate() + 1);
  return date.getTime();
}

function toEvent(spec, now) {
  return {
    id: spec.id,
    sport: spec.sport,
    league: spec.league,
    startTime: new Date(kickoffTime(spec, now)).toISOString(),
    home: { ...spec.home },
    away: { ...spec.away },
    neutral: Boolean(spec.neutral),
    venue: spec.venue,
    markets: marketsFor(spec),
    notes: [...(spec.notes || [])]
  };
}

/**
 * @param {{ now?: () => number }} [options]  Inject a clock for tests.
 * @returns {import("./provider.mjs").OddsProvider}
 */
export function createMockProvider(options = {}) {
  const clock = options.now || Date.now;
  // Snap to a 5-minute grid so repeated requests return identical data.
  const nowMs = () => Math.floor(clock() / TIME_GRID_MS) * TIME_GRID_MS;
  const findSpec = (eventId) => MOCK_EVENTS.find((spec) => spec.id === eventId) || null;

  function timeline(spec, now) {
    const start = now - spec.openedHoursAgo * 3600_000;
    const step = (now - start) / (HISTORY_TICKS - 1);
    return Array.from({ length: HISTORY_TICKS }, (_, i) => Math.round((start + step * i) / 60_000) * 60_000);
  }

  function progressAt(spec, tickIndex, lag) {
    const fraction = Math.max(0, tickIndex - lag) / (HISTORY_TICKS - 1);
    return spec.moves.filter((at) => at <= fraction).length / spec.moves.length;
  }

  function bookMarketsAt(spec, book, tickIndex) {
    const progress = spec.staleBook === book.key ? 0 : progressAt(spec, tickIndex, book.lag);
    return priceBook(spec, book, fairState(spec, progress));
  }

  return {
    id: "mock",
    label: "Mock data",
    live: false,

    async listSports() {
      return SPORTS.map((sport) => ({ ...sport }));
    },

    async listEvents(query = {}) {
      const now = nowMs();
      return MOCK_EVENTS.filter((spec) => !query.sport || spec.sport === query.sport)
        .map((spec) => toEvent(spec, now))
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
    },

    async getEvent(eventId) {
      const spec = findSpec(eventId);
      return spec ? toEvent(spec, nowMs()) : null;
    },

    async getOdds(eventId) {
      const spec = findSpec(eventId);
      if (!spec) return null;
      const now = nowMs();
      return {
        eventId,
        asOf: new Date(now).toISOString(),
        books: MOCK_BOOKS.map((book) => {
          const minutesAgo =
            spec.staleBook === book.key ? 42 : 1 + Math.round((seeded(`${eventId}:${book.key}:age`) + 1) * 4);
          return {
            key: book.key,
            name: book.name,
            updatedAt: new Date(now - minutesAgo * 60_000).toISOString(),
            markets: bookMarketsAt(spec, book, HISTORY_TICKS - 1)
          };
        })
      };
    },

    async getLineHistory(eventId, { market, selection }) {
      const spec = findSpec(eventId);
      if (!spec || !spec[market] || !SELECTIONS[market]?.includes(selection)) return null;
      if (selection === "draw" && spec.moneyline.open.draw === undefined) return null;
      const times = timeline(spec, nowMs());
      return {
        eventId,
        market,
        selection,
        series: MOCK_BOOKS.map((book) => ({
          book: book.key,
          name: book.name,
          points: times.map((t, i) => {
            const outcome = bookMarketsAt(spec, book, i)[market].find((o) => o.selection === selection);
            return { t: new Date(t).toISOString(), price: outcome.price, point: outcome.point };
          })
        }))
      };
    }
  };
}
