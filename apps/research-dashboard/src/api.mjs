// The dashboard's JSON API as a pure function of an OddsProvider. No Node
// APIs: the server mounts it under /api, and the static build runs the same
// code in the browser against the mock provider.

import { buildEventSummary, buildEventView, priceGaps, summarizeHistory } from "./analysis.mjs";
import { MARKETS, SELECTIONS, SPORTS } from "./providers/provider.mjs";

// The event list fetches one odds snapshot per event for its summary line.
// Cap it so a live provider isn't hit with hundreds of requests per page load.
const MAX_LIST_SUMMARIES = 30;

// Dashboard insights scan the next N events. Each costs several upstream
// calls with a live provider, so live mode looks at fewer.
const MAX_INSIGHT_EVENTS = { mock: 20, live: 8 };

export const DISCLAIMER =
  "Research tool only. Prices can be stale, markets can suspend, bets can void, limits apply, and availability depends on your jurisdiction. Nothing here is a guarantee of profit.";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Open -> current for one selection, read from the sharpest available book. */
async function referenceMove(provider, eventId, market, selection) {
  const history = await provider.getLineHistory(eventId, { market, selection });
  const summary = history ? summarizeHistory(history).perBook : [];
  return summary.find((b) => b.book === "pinnacle") || summary[0] || null;
}

async function buildInsights(provider) {
  const events = (await provider.listEvents()).slice(0, provider.live ? MAX_INSIGHT_EVENTS.live : MAX_INSIGHT_EVENTS.mock);
  const movers = [];
  const gaps = [];
  const stale = [];

  await Promise.all(
    events.map(async (event) => {
      const snapshot = await provider.getOdds(event.id);
      if (!snapshot) return;
      const view = buildEventView(event, snapshot);

      for (const gap of priceGaps(view).slice(0, 2)) gaps.push({ eventId: event.id, sport: event.sport, ...gap });
      for (const book of view.bookSummaries.filter((b) => b.stale)) {
        stale.push({ eventId: event.id, sport: event.sport, book: book.name, updatedAt: book.updatedAt });
      }

      const moves = {};
      if (view.markets.moneyline) {
        const [away, home] = await Promise.all([
          referenceMove(provider, event.id, "moneyline", "away"),
          referenceMove(provider, event.id, "moneyline", "home")
        ]);
        const pick = [away && { side: "away", ...away }, home && { side: "home", ...home }]
          .filter(Boolean)
          .sort((a, b) => b.impliedMove - a.impliedMove)[0];
        if (pick) moves.moneyline = { selection: pick.side, name: event[pick.side].name, open: pick.open.price, current: pick.current.price, impliedMove: pick.impliedMove };
      }
      for (const [market, selection] of [["spread", "home"], ["total", "over"]]) {
        if (!view.markets[market]) continue;
        const move = await referenceMove(provider, event.id, market, selection);
        if (move && move.pointMove) moves[market] = { selection, open: move.open.point, current: move.current.point };
      }
      const score = Math.max(
        Math.abs(moves.moneyline?.impliedMove || 0),
        Math.abs((moves.spread?.current ?? 0) - (moves.spread?.open ?? 0)) * 0.03,
        Math.abs((moves.total?.current ?? 0) - (moves.total?.open ?? 0)) * 0.015
      );
      if (score > 0.005) movers.push({ eventId: event.id, sport: event.sport, score, moves });
    })
  );

  movers.sort((a, b) => b.score - a.score);
  gaps.sort((a, b) => b.edge - a.edge);
  return { movers: movers.slice(0, 6), gaps: gaps.slice(0, 6), stale, generatedAt: new Date().toISOString() };
}

/** Resolve one /api/... URL to a JSON-serializable body, or throw HttpError. */
export async function handleApi(provider, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"

  if (parts.length === 1 && parts[0] === "meta") {
    return {
      provider: { id: provider.id, label: provider.label, live: provider.live },
      sports: await provider.listSports(),
      markets: MARKETS,
      disclaimer: DISCLAIMER,
      generatedAt: new Date().toISOString()
    };
  }

  if (parts.length === 1 && parts[0] === "insights") return buildInsights(provider);

  if (parts[0] !== "events") throw new HttpError(404, "Not found");

  if (parts.length === 1) {
    const sport = url.searchParams.get("sport") || undefined;
    if (sport && !SPORTS.some((s) => s.key === sport)) throw new HttpError(400, `Unknown sport "${sport}"`);
    const events = await provider.listEvents({ sport });
    const withSummaries = await Promise.all(
      events.map(async (event, index) => {
        if (index >= MAX_LIST_SUMMARIES) return { ...event, summary: null };
        const snapshot = await provider.getOdds(event.id);
        return { ...event, summary: snapshot ? buildEventSummary(event, snapshot) : null };
      })
    );
    return { events: withSummaries, generatedAt: new Date().toISOString() };
  }

  const eventId = decodeURIComponent(parts[1]);
  const event = await provider.getEvent(eventId);
  if (!event) throw new HttpError(404, "Event not found");

  if (parts.length === 2) {
    const snapshot = await provider.getOdds(eventId);
    if (!snapshot) throw new HttpError(404, "No odds for event");
    return buildEventView(event, snapshot);
  }

  if (parts.length === 3 && parts[2] === "history") {
    const market = url.searchParams.get("market");
    const selection = url.searchParams.get("selection");
    if (!MARKETS.includes(market)) throw new HttpError(400, "market must be moneyline, spread, or total");
    if (!SELECTIONS[market].includes(selection)) throw new HttpError(400, `Invalid selection for ${market}`);
    const history = await provider.getLineHistory(eventId, { market, selection });
    if (!history) throw new HttpError(404, "No line history for selection");
    return summarizeHistory(history);
  }

  throw new HttpError(404, "Not found");
}
