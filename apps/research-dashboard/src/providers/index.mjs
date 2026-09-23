// Picks the data provider from the server environment.
//
//   (nothing set)            -> mock data, no network, no key
//   ODDS_API_KEY=...         -> live Odds API adapter
//
// Optional overrides: ODDS_PROVIDER=mock forces mock data even when a key is
// present; ODDS_API_BASE_URL points the live adapter at another base URL.
//
// To plug in a different vendor, write an adapter that satisfies the
// OddsProvider contract in ./provider.mjs and add it to PROVIDERS below.

import { createMockProvider } from "./mock-provider.mjs";
import { createOddsApiProvider } from "./odds-api-provider.mjs";
import { assertProvider } from "./provider.mjs";

const PROVIDERS = {
  mock: () => createMockProvider(),
  "odds-api": (env, deps) =>
    createOddsApiProvider({
      apiKey: env.ODDS_API_KEY,
      baseUrl: env.ODDS_API_BASE_URL,
      fetchImpl: deps.fetchImpl
    })
};

export function resolveProviderId(env = process.env) {
  const requested = (env.ODDS_PROVIDER || "").trim().toLowerCase();
  if (requested) {
    if (!PROVIDERS[requested]) {
      throw new Error(`Unknown ODDS_PROVIDER "${requested}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}`);
    }
    if (requested === "odds-api" && !env.ODDS_API_KEY) {
      throw new Error("ODDS_PROVIDER=odds-api requires ODDS_API_KEY");
    }
    return requested;
  }
  return env.ODDS_API_KEY ? "odds-api" : "mock";
}

/** @returns {import("./provider.mjs").OddsProvider} */
export function createProvider(env = process.env, deps = {}) {
  return assertProvider(PROVIDERS[resolveProviderId(env)](env, deps));
}
