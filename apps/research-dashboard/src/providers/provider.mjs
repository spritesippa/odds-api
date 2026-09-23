// The provider contract. The frontend only ever sees the normalized shapes
// below (via the server's /api routes), so swapping mock data for a live
// odds source means writing one adapter that satisfies this interface.

/**
 * @typedef {"nfl" | "nba" | "mlb" | "soccer" | "ufc"} SportKey
 * @typedef {"moneyline" | "spread" | "total"} MarketKey
 * @typedef {"home" | "away" | "draw" | "over" | "under"} SelectionKey
 *
 * @typedef {Object} Participant
 * @property {string} name   Full team or fighter name.
 * @property {string} short  Abbreviation for tight layouts.
 *
 * @typedef {Object} SportEvent
 * @property {string} id
 * @property {SportKey} sport
 * @property {string} league
 * @property {string} startTime  ISO 8601 UTC.
 * @property {Participant} home  For neutral-site events (UFC), the red corner.
 * @property {Participant} away  For neutral-site events (UFC), the blue corner.
 * @property {boolean} [neutral]
 * @property {string} [venue]
 * @property {MarketKey[]} markets  Markets this event is expected to carry.
 * @property {string[]} [notes]     Optional research notes (mock data only).
 *
 * @typedef {Object} Outcome
 * @property {SelectionKey} selection
 * @property {string} name
 * @property {number} price          American odds, e.g. -110 or +145.
 * @property {number | null} [point] Spread or total line; null for moneyline.
 *
 * @typedef {Object} BookOdds
 * @property {string} key
 * @property {string} name
 * @property {string} updatedAt  ISO 8601 UTC time this book's prices were captured.
 * @property {Partial<Record<MarketKey, Outcome[]>>} markets
 *
 * @typedef {Object} OddsSnapshot
 * @property {string} eventId
 * @property {string} asOf  ISO 8601 UTC.
 * @property {BookOdds[]} books
 *
 * @typedef {Object} HistoryPoint
 * @property {string} t              ISO 8601 UTC.
 * @property {number} price          American odds.
 * @property {number | null} point
 *
 * @typedef {Object} LineHistory
 * @property {string} eventId
 * @property {MarketKey} market
 * @property {SelectionKey} selection
 * @property {{ book: string, name: string, points: HistoryPoint[] }[]} series
 *
 * @typedef {Object} OddsProvider
 * @property {string} id
 * @property {string} label
 * @property {boolean} live  True when prices come from a real-time source.
 * @property {() => Promise<{ key: SportKey, label: string }[]>} listSports
 * @property {(query?: { sport?: SportKey }) => Promise<SportEvent[]>} listEvents
 * @property {(eventId: string) => Promise<SportEvent | null>} getEvent
 * @property {(eventId: string) => Promise<OddsSnapshot | null>} getOdds
 * @property {(eventId: string, query: { market: MarketKey, selection: SelectionKey }) => Promise<LineHistory | null>} getLineHistory
 */

export const SPORTS = [
  { key: "nfl", label: "NFL" },
  { key: "nba", label: "NBA" },
  { key: "mlb", label: "MLB" },
  { key: "soccer", label: "Soccer" },
  { key: "ufc", label: "UFC" }
];

export const MARKETS = ["moneyline", "spread", "total"];

export const SELECTIONS = {
  moneyline: ["away", "draw", "home"],
  spread: ["away", "home"],
  total: ["over", "under"]
};

const REQUIRED_METHODS = ["listSports", "listEvents", "getEvent", "getOdds", "getLineHistory"];

/** Throws if `provider` does not implement the OddsProvider contract. */
export function assertProvider(provider) {
  if (!provider || typeof provider !== "object") throw new TypeError("Provider must be an object");
  for (const field of ["id", "label"]) {
    if (typeof provider[field] !== "string" || !provider[field]) {
      throw new TypeError(`Provider is missing string field "${field}"`);
    }
  }
  if (typeof provider.live !== "boolean") throw new TypeError('Provider is missing boolean field "live"');
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new TypeError(`Provider "${provider.id}" is missing method ${method}()`);
    }
  }
  return provider;
}
