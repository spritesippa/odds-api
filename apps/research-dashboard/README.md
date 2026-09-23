# Odds research dashboard

A dark, mobile-first sports betting **research** dashboard that runs entirely on realistic mock data, with no API key and no network calls. A bottom navigation bar (a left rail on desktop) has four sections:

- **Dashboard:** your picks record (profit/loss, ROI, win rate, units), the biggest line moves, the best prices compared with the market's no-vig fair odds, stale-price alerts, and the next games up.
- **Games:** sportsbook-style game cards (Spread / Total / Money, or Run line, Handicap, 1X2 and Rounds where those fit). Each game has a research screen with best price and fair value, a comparison of 6 books, line-movement charts, and sportsbook cards. It covers 15 mock events: 3 each for NFL, NBA, MLB, soccer (Premier League, La Liga, Bundesliga) and UFC. The UFC fighters are fictional.
- **Picks:** add a mock pick manually with sport, matchup, bet type (moneyline, spread, total, prop, parlay), selection, American odds, stake in units, result (pending, win, loss, push) and notes. Profit/loss, units risked, win rate and ROI update automatically, and there's a P/L chart. Tap any price in Games to prefill a pick.
- **Settings:** odds format (American or decimal), the dollar value of one unit, default stake, CSV export, reset to sample picks, and delete all picks.

Picks and settings are stored only in your browser (`localStorage`) and sync across open tabs. Picks saved by the earlier version of the app are migrated automatically.

The app does **not** place bets, log into sportsbooks, scrape sites, or automate any account. A small provider layer lets you switch to a live odds API later by setting one server-side environment variable. The frontend stays the same.

## Run it

Requires Node 20+. There are no dependencies to install.

```bash
cd apps/research-dashboard
npm start          # http://127.0.0.1:4173
npm test           # node:test suite (math, providers, API)
```

`PORT` and `HOST` override the listen address.

### Static build (no server)

```bash
npm run build:static   # writes build/static/
```

This produces a self-contained copy that runs the same API code (`src/api.mjs`) in the browser against the mock provider, so it can be hosted as plain files. It contains mock data only: the live provider and anything to do with an API key are left out, and a test enforces that. `index.html` in the build holds page content only (title, links, markup) for hosts that supply their own HTML skeleton.

`npm run build:site` writes the same thing as a full HTML page to `build/site/` for a plain static host such as GitHub Pages. All paths are relative, so it also works under a `/repo-name/` subpath.

The app uses tap-twice buttons instead of `confirm()` dialogs, and copies CSV to the clipboard instead of downloading a file, because embedded and sandboxed viewers often block both.

## Architecture

```text
browser (public/*)  ──fetch──▶  server.mjs  /api/*  ──▶  analysis.mjs  ──▶  OddsProvider
   app.js       router, top bar, bottom nav; transport.js = HTTP (or in-browser in the static build)              (implied, no-vig,     ├─ mock-provider.mjs     (default)
   dashboard.js / games.js / picks.js / settings.js       hold, best, consensus) └─ odds-api-provider.mjs (ODDS_API_KEY)
   store.js     picks + settings in localStorage (validated, migrated)
   chart.js     SVG charts          format.js / dom.js  helpers
        └── imports src/lib/odds-math.mjs (shared pure math: odds, no-vig, P/L, ROI)
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
| `GET /api/insights` | biggest line moves, best prices vs no-vig fair odds, stale books (for the Dashboard) |

## Switching to live data later

1. Set **one private environment variable on the server** (never in frontend code):

   ```bash
   ODDS_API_KEY=your_key npm start
   ```

   With a key present, the server uses `odds-api-provider.mjs`. That adapter sends the key as an `X-API-Key` header, caches responses for 30 seconds, and maps responses into the normalized shapes. The browser never receives the key. See `.env.example`.

2. Optional variables: `ODDS_PROVIDER=mock` forces mock data even when a key is set. `ODDS_API_BASE_URL` overrides the base URL. `DASHBOARD_PASSWORD` requires a password. `TRUST_PROXY=1` goes with a hosting proxy.

> The live adapter follows this repo's `openapi.yaml` and the SDK's sample responses. It's tested against a fake odds-api.net server, covering main-line pairing of alternate spreads and totals, skipping corners and cards totals, and caching. It has **not** been run against the live service yet. If a market comes back empty, compare a real snapshot's `market_key`, `side`, `period` and `metric` values with `normalizeMarket()` and `MAIN_METRICS` in `src/providers/odds-api-provider.mjs`.

### Deploy to Render (live data)

`render.yaml` at the repo root describes the service, so Render can set it up for you:

1. In Render, choose **New → Blueprint** and connect this GitHub repo. Pick the branch that contains `render.yaml`.
2. Render asks for two secret values, which are stored in Render and not in the repo:
   - `ODDS_API_KEY`: your odds-api.net key. Setting it turns on live data.
   - `DASHBOARD_PASSWORD`: a password for the site (enter any username). Set one, because every visitor's page loads spend your API quota.
3. Deploy. The site is available at `https://<service-name>.onrender.com`.

Protections built in for a public deployment:

| | |
| --- | --- |
| Key stays server-side | sent to odds-api.net as a header, never to the browser; error messages never include it |
| Password (optional) | HTTP Basic auth on every page and API route; `/healthz` stays open for Render's health check |
| Upstream caching | events 60 s, prices 30 s, line history 2 min, event details 5 min; identical concurrent requests share one call |
| Shared Dashboard cache | `/api/insights` is computed once every 2 minutes for all visitors and scans 8 live games (20 in mock mode) |
| Rate limits | 120 API requests per visitor per minute, 600 in total per minute across all visitors |

On Render's free plan the service sleeps after about 15 minutes idle, so the first visit afterwards takes up to a minute to wake it. Picks remain stored in each visitor's browser.

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
| Pick profit/loss | win: stake × (decimal odds − 1) · loss: −stake · push or pending: 0 |
| Win rate | wins ÷ (wins + losses). Pushes and pending picks are excluded. |
| Units risked | total stake on settled picks (win, loss, push). Pending stake is shown separately. |
| ROI | profit ÷ units risked |

## Mock data

`src/data/mock-events.mjs` holds the scenarios: fair (no-vig) probabilities and lines at open and now, the times when moves happen, and notes. `mock-provider.mjs` generates every book's prices from them. Each book has its own margin, rounding, shading, update lag, and occasional half-point off consensus. As a result, the tables, charts, and history always agree, and the data is deterministic within a 5-minute window. Start times are relative to now, snapped to realistic start slots (for example NFL at 1 PM ET, MLB at 7:05 PM ET), so the slate never goes stale. Team names are real but every matchup, price, injury, and weather note is invented. One book in the Hale vs Volkov fight deliberately shows a stale opening price, so the stale-line warnings have an example to display.

## Responsible use

Odds move, markets suspend, bets void, limits apply, and availability depends on your jurisdiction. A positive "vs consensus" number is not guaranteed profit. It is often a stale price that will be pulled or limited.
