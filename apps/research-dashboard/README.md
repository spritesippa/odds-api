# Odds research dashboard

A sports betting **research** dashboard that runs entirely on realistic mock data, with no API key and no network calls. A small provider layer lets you switch to a live odds API later by setting one server-side environment variable. The frontend stays the same.

- **Sports:** NFL, NBA, MLB, soccer (Premier League, La Liga), and UFC. The UFC fighters are fictional.
- **Markets:** moneyline (3-way 1X2 for soccer), spread / run line / Asian handicap, and totals.
- **Per selection:** best available price, implied probability, no-vig probability, a consensus fair price, the Pinnacle (sharp) no-vig reference, and best price vs consensus.
- **Sportsbook comparison:** a comparison table (★ marks the best price) and a card per book showing hold, how many best prices it has, and when it last updated. Stale books are flagged.
- **Line movement:** a per-book chart of implied probability over time, plus a separate chart of the spread/total line and an open → current table. Each mock event has notes explaining its move: a key-number cross, an injury, a pitcher scratch, a stale book, and so on.
- **Personal picks tracker:** units, profit/loss, win rate, ROI, record, a cumulative P/L chart, and CSV export. Picks are stored only in your browser. Click any price on the Markets tab to prefill a pick.

It does **not** place bets, log into sportsbooks, scrape sites, or automate any account.

## Run it

Requires Node 20+. There are no dependencies to install.

```bash
cd apps/research-dashboard
npm start          # http://127.0.0.1:4173
npm test           # node:test suite (math, providers, API)
```

`PORT` and `HOST` override the listen address.

## Architecture

```text
browser (public/*)  ──fetch──▶  server.mjs  /api/*  ──▶  analysis.mjs  ──▶  OddsProvider
   app.js  (markets)                                    (implied, no-vig,     ├─ mock-provider.mjs     (default)
   picks.js (tracker, localStorage)                      hold, best, consensus) └─ odds-api-provider.mjs (ODDS_API_KEY)
   chart.js (SVG charts)
        └── imports src/lib/odds-math.mjs (shared pure math)
```

- **`src/providers/provider.mjs`** defines the contract: normalized `SportEvent`, `OddsSnapshot`, and `LineHistory` shapes (JSDoc), plus `assertProvider()`.
- **`src/providers/index.mjs`** picks the provider from the environment.
- **`src/analysis.mjs`** is provider-agnostic. It turns raw prices into the numbers the UI shows.
- **The frontend only calls `/api/*`.** It never talks to an odds vendor and never sees a key.

### API routes

| Route | Returns |
| --- | --- |
| `GET /api/meta` | provider id/label/live flag, sports, disclaimer |
| `GET /api/events?sport=nfl` | upcoming events with a compact odds summary |
| `GET /api/events/:id` | per-market comparison rows, consensus, best prices, sportsbook summaries |
| `GET /api/events/:id/history?market=spread&selection=home` | per-book line history plus open/current deltas |

## Switching to live data later

1. Set **one private environment variable on the server** (never in frontend code):

   ```bash
   ODDS_API_KEY=your_key npm start
   ```

   With a key present, the server uses `odds-api-provider.mjs`. That adapter sends the key as an `X-API-Key` header, caches responses for 30 seconds, and maps responses into the normalized shapes. The browser never receives the key. See `.env.example`.

2. Optional variables: `ODDS_PROVIDER=mock` forces mock data even when a key is set. `ODDS_API_BASE_URL` overrides the base URL.

> The live adapter was written against this repo's `openapi.yaml` and unit-tested with a fake `fetch`. It has **not** been run against the live service yet. Market names vary by bookmaker, so check a few real responses before relying on it, and extend `normalizeMarket()` if a market comes back empty.

### Using a different odds vendor

Write one adapter and register it. You don't need to change the frontend:

```js
// src/providers/my-vendor-provider.mjs
export function createMyVendorProvider({ apiKey }) {
  return {
    id: "my-vendor",
    label: "My Vendor (live)",
    live: true,
    async listSports() { /* [{ key: "nfl", label: "NFL" }, ...] */ },
    async listEvents({ sport } = {}) { /* SportEvent[] */ },
    async getEvent(eventId) { /* SportEvent | null */ },
    async getOdds(eventId) { /* OddsSnapshot: American prices, points for spreads/totals */ },
    async getLineHistory(eventId, { market, selection }) { /* LineHistory | null */ }
  };
}
```

Then add it to `PROVIDERS` in `src/providers/index.mjs` and select it with `ODDS_PROVIDER=my-vendor`, or make it the default when its key is set. `assertProvider()` rejects adapters that are missing methods, and `test/providers.test.mjs` shows how to test an adapter with an injected `fetch`.

## How the numbers are computed

| Metric | Formula |
| --- | --- |
| Implied probability | `1 / decimal odds` (includes the book's margin) |
| Hold | `Σ implied − 1` across all outcomes of one book's market |
| No-vig probability | each implied probability ÷ Σ implied (proportional method; works for 2-way and 3-way markets) |
| Consensus | average no-vig probability across books at the most common line. Books not updated in 15+ minutes are excluded. |
| Fair price | consensus probability converted back to American odds |
| Best price vs consensus | `consensus probability × decimal odds − 1`. It is an estimate, shown only when the best price is at the consensus line. |
| Win rate | wins ÷ (wins + losses). Pushes and voids are excluded. |
| ROI | profit ÷ units risked on graded picks (won, lost, push) |

## Mock data

`src/data/mock-events.mjs` holds the scenarios: fair (no-vig) probabilities and lines at open and now, the times when moves happen, and notes. `mock-provider.mjs` generates every book's prices from them. Each book has its own margin, rounding, shading, update lag, and occasional half-point off consensus. As a result, the tables, charts, and history always agree, and the data is deterministic within a 5-minute window. Start times are relative to now, so the slate never goes stale. Team names are real but every matchup, price, injury, and weather note is invented. One book in the Hale vs Volkov fight deliberately shows a stale opening price, so the stale-line warnings have an example to display.

## Responsible use

Odds move, markets suspend, bets void, limits apply, and availability depends on your jurisdiction. A positive "vs consensus" number is not guaranteed profit. It is often a stale price that will be pulled or limited.
