// Turns a provider's raw OddsSnapshot into research views: implied and
// no-vig probabilities, hold, best available prices, and market consensus.
// Provider-agnostic: works the same for mock and live data.

import {
  americanToDecimal,
  expectedValue,
  impliedProbability,
  marketHold,
  noVigProbabilities,
  probabilityToAmerican
} from "./lib/odds-math.mjs";
import { MARKETS, SELECTIONS } from "./providers/provider.mjs";

const SHARP_BOOK = "pinnacle";
// Books whose prices are older than this (relative to the snapshot) are shown
// but left out of the consensus, so one stale number can't skew fair value.
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** The number that identifies a market's line: home spread or total points. */
function lineOf(market, outcomes) {
  if (market === "moneyline") return null;
  const anchor = outcomes.find((o) => o.selection === (market === "spread" ? "home" : "over"));
  return anchor ? anchor.point : null;
}

function mode(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && Math.abs(value) < Math.abs(best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Returns >0 when outcome `a` is better for the bettor than `b`. */
function compareForBettor(market, selection, a, b) {
  if (market === "spread" && a.point !== b.point) return a.point - b.point;
  if (market === "total" && a.point !== b.point) {
    return selection === "over" ? b.point - a.point : a.point - b.point;
  }
  return americanToDecimal(a.price) - americanToDecimal(b.price);
}

function selectionOrder(market, rows) {
  return SELECTIONS[market].filter((selection) =>
    rows.some((row) => row.outcomes.some((o) => o.selection === selection))
  );
}

export function buildMarketView(snapshot, market) {
  const raw = snapshot.books
    .filter((book) => Array.isArray(book.markets[market]) && book.markets[market].length >= 2)
    .map((book) => ({ book, outcomes: book.markets[market] }));
  if (raw.length === 0) return null;

  const selections = selectionOrder(market, raw);
  const asOf = new Date(snapshot.asOf).getTime();
  const rows = raw
    .filter(({ outcomes }) => selections.every((s) => outcomes.some((o) => o.selection === s)))
    .map(({ book, outcomes }) => {
      const ordered = selections.map((s) => outcomes.find((o) => o.selection === s));
      const prices = ordered.map((o) => o.price);
      const noVig = noVigProbabilities(prices);
      return {
        book: book.key,
        bookName: book.name,
        updatedAt: book.updatedAt,
        stale: asOf - new Date(book.updatedAt).getTime() > STALE_AFTER_MS,
        line: lineOf(market, ordered),
        hold: marketHold(prices),
        outcomes: ordered.map((o, i) => ({
          selection: o.selection,
          name: o.name,
          price: o.price,
          point: o.point ?? null,
          decimal: americanToDecimal(o.price),
          implied: impliedProbability(o.price),
          noVig: noVig[i],
          isBest: false
        }))
      };
    });
  if (rows.length === 0) return null;

  const fresh = rows.some((row) => !row.stale) ? rows.filter((row) => !row.stale) : rows;
  const consensusLine = market === "moneyline" ? null : mode(fresh.map((row) => row.line));
  const atConsensus = fresh.filter((row) => row.line === consensusLine);
  const sharp = rows.find((row) => row.book === SHARP_BOOK && row.line === consensusLine);

  const consensus = {};
  const best = {};
  selections.forEach((selection, i) => {
    const avg = atConsensus.reduce((sum, row) => sum + row.outcomes[i].noVig, 0) / atConsensus.length;
    const point = atConsensus[0].outcomes[i].point;
    consensus[selection] = {
      point,
      noVig: avg,
      fairPrice: probabilityToAmerican(avg),
      sharpNoVig: sharp ? sharp.outcomes[i].noVig : null
    };

    let top = rows[0];
    for (const row of rows) {
      if (compareForBettor(market, selection, row.outcomes[i], top.outcomes[i]) > 0) top = row;
    }
    const outcome = top.outcomes[i];
    const sameLine = market === "moneyline" || outcome.point === point;
    best[selection] = {
      book: top.book,
      bookName: top.bookName,
      price: outcome.price,
      point: outcome.point,
      implied: outcome.implied,
      stale: top.stale,
      // Price vs consensus only means something at the same line.
      edgeVsConsensus: sameLine ? expectedValue(avg, outcome.price) : null
    };
    for (const row of rows) {
      const o = row.outcomes[i];
      o.isBest = compareForBettor(market, selection, o, outcome) === 0;
    }
  });

  return {
    market,
    selections,
    consensusLine,
    rows,
    consensus,
    best,
    avgHold: rows.reduce((sum, row) => sum + row.hold, 0) / rows.length,
    lowHold: rows.reduce((low, row) => (row.hold < low.hold ? row : low), rows[0]).book
  };
}

export function buildEventView(event, snapshot) {
  const markets = {};
  for (const market of MARKETS) {
    const view = buildMarketView(snapshot, market);
    if (view) markets[market] = view;
  }

  const bookSummaries = snapshot.books.map((book) => {
    let bestCount = 0;
    const holds = {};
    for (const view of Object.values(markets)) {
      const row = view.rows.find((r) => r.book === book.key);
      if (!row) continue;
      holds[view.market] = row.hold;
      bestCount += row.outcomes.filter((o) => o.isBest).length;
    }
    const holdValues = Object.values(holds);
    return {
      book: book.key,
      name: book.name,
      updatedAt: book.updatedAt,
      holds,
      avgHold: holdValues.length ? holdValues.reduce((a, b) => a + b, 0) / holdValues.length : null,
      bestCount,
      markets: book.markets
    };
  });

  return { event, asOf: snapshot.asOf, markets, bookSummaries };
}

/** Compact numbers for an event list row. */
export function buildEventSummary(event, snapshot) {
  const view = buildEventView(event, snapshot);
  const summary = { bookCount: snapshot.books.length };
  if (view.markets.moneyline) {
    summary.moneyline = Object.fromEntries(
      Object.entries(view.markets.moneyline.best).map(([selection, best]) => [
        selection,
        { price: best.price, book: best.bookName, fair: view.markets.moneyline.consensus[selection].noVig }
      ])
    );
  }
  if (view.markets.spread) summary.spread = view.markets.spread.consensusLine;
  if (view.markets.total) summary.total = view.markets.total.consensusLine;
  return summary;
}

/** Opening vs current, per book, for a line-history response. */
export function summarizeHistory(history) {
  const perBook = history.series
    .filter((series) => series.points.length > 0)
    .map((series) => {
      const first = series.points[0];
      const last = series.points[series.points.length - 1];
      return {
        book: series.book,
        name: series.name,
        open: first,
        current: last,
        impliedMove: impliedProbability(last.price) - impliedProbability(first.price),
        pointMove: first.point !== null && last.point !== null ? last.point - first.point : null
      };
    });
  return { ...history, perBook };
}
