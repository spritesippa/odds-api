// Games: sportsbook-style game cards and a per-game research screen
// (fair value, book comparison, line movement, sportsbook cards).
// Tapping any price opens the pick form prefilled; nothing is ever wagered.

import { api, isCurrent, navigate, setChrome } from "/app.js";
import { hideTooltip, lineChart } from "/chart.js";
import { card, el, icon, sectionHead, segmented, SPORT_LABELS } from "/dom.js";
import {
  ago,
  dateTime,
  formatPercent,
  formatPoint,
  kickoff,
  lineText,
  marketLabel,
  odds,
  shortDateTime,
  shortMarketLabel,
  signedPct,
  tone
} from "/format.js";
import { setPickPrefill } from "/picks.js";

const MARKETS = ["spread", "total", "moneyline"];
const DESKTOP = "(min-width: 960px)";

// Color follows the sportsbook, never its rank. Order validated for CVD
// separation on the dark surface; unknown books take the next free slot.
const BOOK_SLOTS = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars", "betrivers"];
const bookColors = new Map(BOOK_SLOTS.map((key, i) => [key, `var(--series-${i + 1})`]));
export function bookColor(key) {
  if (!bookColors.has(key)) {
    const slot = bookColors.size + 1;
    bookColors.set(key, slot <= 6 ? `var(--series-${slot})` : "var(--muted)");
  }
  return bookColors.get(key);
}

const state = { sport: "all", market: "moneyline", selection: null, eventId: null, view: null };

export function matchup(event) {
  return event.neutral ? `${event.home.name} vs ${event.away.name}` : `${event.away.name} @ ${event.home.name}`;
}

function leagueLabel(event) {
  const sport = SPORT_LABELS[event.sport] || event.sport;
  return event.league && event.league !== sport ? `${sport} · ${event.league}` : sport;
}

function selectionName(event, selection) {
  if (selection === "draw") return "Draw";
  if (selection === "over") return "Over";
  if (selection === "under") return "Under";
  return event[selection].name;
}

/** Text for a pick's "Selection" field. */
function pickSelection(event, market, selection, point) {
  if (market === "moneyline") return selection === "draw" ? "Draw" : event[selection].name;
  if (market === "spread") return `${event[selection].name} ${formatPoint(point)}`;
  return `${selection === "over" ? "Over" : "Under"} ${point}${event.sport === "ufc" ? " rounds" : ""}`;
}

function addPick(event, market, selection, price, point, book) {
  setPickPrefill({
    sport: event.sport,
    matchup: matchup(event),
    betType: market,
    selection: pickSelection(event, market, selection, point),
    odds: price,
    book: book || ""
  });
  navigate("#/picks/new");
}

function priceButton({ event, market, selection, price, point, book, best = false, label, compact = false }) {
  const line = lineText(market, selection, point);
  return el(
    "button",
    {
      type: "button",
      class: `odds-btn${best ? " best" : ""}${compact ? " compact" : ""}`,
      "aria-label": `${label || pickSelection(event, market, selection, point)} ${odds(price)}${book ? ` at ${book}` : ""}${best ? ", best price" : ""}. Add to picks.`,
      onclick: (e) => {
        e.stopPropagation();
        addPick(event, market, selection, price, point, book);
      }
    },
    [line ? el("span", { class: "odds-line" }, line) : null, el("span", { class: "odds-price" }, odds(price))]
  );
}

const dash = () => el("span", { class: "odds-btn empty", "aria-hidden": "true" }, "—");

// ---------- list ----------

function gameCard(event, selectedId) {
  const markets = event.summary?.markets || {};
  const rowFor = (side) => {
    const cells = MARKETS.map((market) => {
      const sel = market === "total" ? (side === "away" ? "over" : "under") : side;
      const headline = markets[market]?.selections?.[sel];
      if (!headline) return dash();
      return priceButton({ event, market, selection: sel, price: headline.price, point: headline.point, book: headline.book, compact: true });
    });
    return el("div", { class: "game-row" }, [
      el("span", { class: "team" }, [el("span", { class: "team-name" }, event[side].name)]),
      ...cells
    ]);
  };
  const draw = markets.moneyline?.selections?.draw;

  return el("article", { class: `game-card${event.id === selectedId ? " selected" : ""}`, "data-event-id": event.id }, [
    el("a", { class: "game-card-head", href: `#/games/${event.id}` }, [
      el("span", { class: "league" }, leagueLabel(event)),
      el("span", { class: "kickoff" }, kickoff(event.startTime))
    ]),
    el("div", { class: "game-grid" }, [
      el("div", { class: "game-row labels", "aria-hidden": "true" }, [
        el("span", {}, ""),
        ...MARKETS.map((m) => el("span", {}, shortMarketLabel(event.sport, m)))
      ]),
      rowFor("away"),
      rowFor("home"),
      draw
        ? el("div", { class: "game-row" }, [
            el("span", { class: "team" }, [el("span", { class: "team-name muted" }, "Draw")]),
            dash(),
            dash(),
            priceButton({ event, market: "moneyline", selection: "draw", price: draw.price, point: null, book: draw.book, compact: true })
          ])
        : null
    ]),
    el("a", { class: "game-card-foot", href: `#/games/${event.id}` }, [
      el("span", {}, [
        `${event.summary?.bookCount ?? 0} books`,
        event.notes?.length ? el("span", { class: "tag warn" }, "Line moved") : null,
        event.summary?.staleBooks ? el("span", { class: "tag bad" }, "Stale price") : null
      ]),
      el("span", { class: "link" }, ["Research", icon("chevron")])
    ])
  ]);
}

function sportChips(meta, onPick) {
  const sports = [{ key: "all", label: "All" }, ...meta.sports];
  return el(
    "div",
    { class: "chips scroll-x", role: "group", "aria-label": "Sport" },
    sports.map((s) =>
      el(
        "button",
        { type: "button", class: "chip", "aria-pressed": String(state.sport === s.key), onclick: () => onPick(s.key) },
        s.label
      )
    )
  );
}

// ---------- detail ----------

function fairValue(event, market) {
  const cards = market.selections.map((selection) => {
    const best = market.best[selection];
    const consensus = market.consensus[selection];
    const edge = best.edgeVsConsensus;
    const line = lineText(market.market, selection, consensus.point);
    return el("div", { class: "fv-card" }, [
      el("div", { class: "fv-name" }, [selectionName(event, selection), line ? el("span", { class: "muted" }, ` ${line}`) : null]),
      el("div", { class: "fv-price-row" }, [
        priceButton({ event, market: market.market, selection, price: best.price, point: best.point, book: best.bookName, best: true }),
        el("span", { class: `fv-book${best.stale ? " neg" : ""}` }, [`Best at ${best.bookName}`, best.stale ? " · stale" : ""])
      ]),
      el(
        "div",
        { class: "prob-bar", role: "img", "aria-label": `Implied ${formatPercent(best.implied)}, no-vig ${formatPercent(consensus.noVig)}` },
        [
          el("span", { class: "bar implied", style: { width: `${best.implied * 100}%` } }),
          el("span", { class: "bar fair", style: { width: `${consensus.noVig * 100}%` } })
        ]
      ),
      el("dl", { class: "stats" }, [
        el("dt", {}, "Implied"),
        el("dd", {}, formatPercent(best.implied)),
        el("dt", {}, "No-vig"),
        el("dd", {}, formatPercent(consensus.noVig)),
        el("dt", {}, "Fair odds"),
        el("dd", {}, odds(consensus.fairPrice)),
        consensus.sharpNoVig !== null ? el("dt", { title: "Pinnacle (sharp book) no-vig probability" }, "Sharp") : null,
        consensus.sharpNoVig !== null ? el("dd", {}, formatPercent(consensus.sharpNoVig)) : null,
        el("dt", {}, "vs market"),
        el("dd", { class: tone(edge) }, edge === null ? "diff. line" : signedPct(edge))
      ]),
      best.stale || edge > 0.05 ? el("p", { class: "fine neg" }, "Large gap — likely a stale price. Verify before trusting it.") : null
    ]);
  });
  return card(
    [
      sectionHead("Best price & fair value", el("span", { class: "fine" }, `Avg hold ${formatPercent(market.avgHold)}`)),
      el("div", { class: "legend" }, [
        el("span", { class: "key" }, [el("i", { class: "swatch implied" }), "Implied (with vig)"]),
        el("span", { class: "key" }, [el("i", { class: "swatch fair" }), "No-vig consensus"])
      ]),
      el("div", { class: `fv-grid n${market.selections.length}` }, cards),
      el(
        "p",
        { class: "fine" },
        "No-vig: each book's implied probabilities rescaled to 100%, averaged across up-to-date books at the main line. “vs market” is an estimate, not a guaranteed edge."
      )
    ],
    "fair-value"
  );
}

function compareTable(event, market) {
  const head = el("tr", {}, [
    el("th", { scope: "col" }, "Book"),
    ...market.selections.map((s) =>
      el("th", { scope: "col", class: "num" }, s === "draw" ? "Draw" : s === "over" ? "Over" : s === "under" ? "Under" : event[s].short)
    )
  ]);
  const rows = market.rows.map((row) =>
    el("tr", { class: row.stale ? "stale-row" : "" }, [
      el("th", { scope: "row" }, [
        el("span", { class: "book-name" }, [el("i", { class: "dot", style: { background: bookColor(row.book) } }), row.bookName]),
        el("span", { class: `book-meta${row.stale ? " neg" : ""}` }, `${formatPercent(row.hold)} hold · ${ago(row.updatedAt)}${row.stale ? " · stale" : ""}`)
      ]),
      ...row.outcomes.map((o) =>
        el("td", {}, [
          priceButton({ event, market: market.market, selection: o.selection, price: o.price, point: o.point, book: row.bookName, best: o.isBest }),
          el("span", { class: "sub" }, `${formatPercent(o.implied, 0)} · nv ${formatPercent(o.noVig, 0)}`)
        ])
      )
    ])
  );
  return card([
    sectionHead("Compare books", el("span", { class: "fine" }, "Green = best price")),
    el("table", { class: `compare n${market.selections.length}` }, [el("thead", {}, head), el("tbody", {}, rows)])
  ]);
}

function movementCard(event, market) {
  if (!market.selections.includes(state.selection)) {
    state.selection = market.selections.includes("home") ? "home" : market.selections[0];
  }
  const picker = segmented(
    market.selections.map((s) => [s, s === "home" || s === "away" ? event[s].short : selectionName(event, s)]),
    state.selection,
    (value) => {
      state.selection = value;
      renderDetailBody();
    },
    { label: "Selection" }
  );
  return card(
    [
      sectionHead("Line movement", picker),
      el("p", { class: "fine" }, "Implied probability of this price at each book (higher = shorter odds)."),
      el("div", { class: "legend", id: "move-legend" }),
      el("div", { class: "chart", id: "move-chart" }, el("div", { class: "chart-empty" }, "Loading…")),
      market.market !== "moneyline" ? el("h3", { class: "subhead" }, `${marketLabel(event.sport, market.market)} line`) : null,
      market.market !== "moneyline" ? el("div", { class: "chart", id: "move-points" }) : null,
      el("div", { id: "move-table" })
    ],
    "movement"
  );
}

async function loadHistory(event, market, token) {
  const selection = state.selection;
  let history;
  try {
    history = await api(`/api/events/${encodeURIComponent(event.id)}/history?market=${market.market}&selection=${selection}`);
  } catch (error) {
    const chart = document.getElementById("move-chart");
    if (chart && isCurrent(token)) chart.replaceChildren(el("div", { class: "chart-empty" }, `No line history: ${error.message}`));
    return;
  }
  if (!isCurrent(token) || state.selection !== selection || state.market !== market.market) return;
  if (!document.getElementById("move-chart")) return;

  const toSeries = (fn) =>
    history.series.map((s) => ({
      id: s.book,
      name: s.name,
      color: bookColor(s.book),
      points: s.points.map((p) => ({ x: Date.parse(p.t), y: fn(p), raw: p }))
    }));
  const implied = (p) => (p.price > 0 ? 100 / (p.price + 100) : -p.price / (-p.price + 100));
  const fmtLine = (p) => (p.point === null || p.point === undefined ? "" : `${market.market === "spread" ? formatPoint(p.point) : p.point} `);

  document.getElementById("move-legend").replaceChildren(
    ...history.series.map((s) => el("span", { class: "key" }, [el("i", { class: "swatch line", style: { background: bookColor(s.book) } }), s.name]))
  );
  const xFormat = (x, long) => (long ? dateTime(x) : shortDateTime(x));
  lineChart(document.getElementById("move-chart"), {
    series: toSeries(implied),
    step: true,
    yFormat: (v) => `${Math.round(v * 100)}%`,
    xFormat,
    tooltipFormat: (p) => `${fmtLine(p.raw)}${odds(p.raw.price)} · ${formatPercent(p.y)}`,
    height: 220,
    ariaLabel: `Line movement for ${selectionName(event, selection)}: implied probability by sportsbook. Values are listed in the table below.`
  });
  const pointsChart = document.getElementById("move-points");
  if (pointsChart) {
    lineChart(pointsChart, {
      series: toSeries((p) => p.point ?? 0),
      step: true,
      yFormat: (v) => {
        const half = Math.round(v * 2) / 2;
        return market.market === "spread" ? formatPoint(half) : String(half);
      },
      xFormat,
      tooltipFormat: (p) => `${fmtLine(p.raw)}(${odds(p.raw.price)})`,
      height: 140,
      yPadding: 0.5,
      ariaLabel: `${marketLabel(event.sport, market.market)} line by sportsbook over time`
    });
  }
  document.getElementById("move-table").replaceChildren(
    el("table", { class: "move-table" }, [
      el(
        "thead",
        {},
        el("tr", {}, [
          el("th", { scope: "col" }, "Book"),
          el("th", { scope: "col", class: "num" }, "Open"),
          el("th", { scope: "col", class: "num" }, "Now"),
          el("th", { scope: "col", class: "num" }, "Δ prob")
        ])
      ),
      el(
        "tbody",
        {},
        history.perBook.map((b) =>
          el("tr", {}, [
            el("th", { scope: "row" }, [el("i", { class: "dot", style: { background: bookColor(b.book) } }), b.name]),
            el("td", { class: "num" }, `${fmtLine(b.open)}${odds(b.open.price)}`),
            el("td", { class: "num" }, `${fmtLine(b.current)}${odds(b.current.price)}`),
            el("td", { class: `num ${tone(b.impliedMove)}` }, signedPct(b.impliedMove))
          ])
        )
      )
    ])
  );
}

function bookCards(event) {
  const { markets, bookSummaries } = state.view;
  const fresh = bookSummaries.filter((b) => b.avgHold !== null);
  const lowest = fresh.reduce((low, b) => (!low || b.avgHold < low.avgHold ? b : low), null);
  const mostBest = bookSummaries.reduce((top, b) => (b.bestCount > (top?.bestCount ?? 0) ? b : top), null);

  const cell = (market, outcomes, selection) => {
    const o = outcomes?.find((x) => x.selection === selection);
    if (!o) return "—";
    return `${lineText(market, selection, o.point)} ${odds(o.price)}`.trim();
  };

  return card([
    sectionHead("Sportsbooks", el("span", { class: "fine" }, "Lower hold = less margin")),
    el(
      "div",
      { class: "book-grid" },
      bookSummaries.map((book) =>
        el("div", { class: "book-card" }, [
          el("div", { class: "book-card-head" }, [
            el("span", { class: "book-name" }, [el("i", { class: "dot", style: { background: bookColor(book.book) } }), book.name]),
            el("span", { class: `fine${book.stale ? " neg" : ""}` }, `${ago(book.updatedAt)}${book.stale ? " · stale" : ""}`)
          ]),
          el("div", { class: "tags" }, [
            book === lowest ? el("span", { class: "tag pos" }, "Lowest hold") : null,
            book === mostBest && book.bestCount > 0 ? el("span", { class: "tag pos" }, "Most best prices") : null,
            el("span", { class: "tag" }, `Hold ${formatPercent(book.avgHold)}`),
            el("span", { class: "tag" }, `Best on ${book.bestCount}`)
          ]),
          el("div", { class: "book-lines" }, [
            el("span", { class: "fine" }, ""),
            el("span", { class: "fine" }, event.away.short),
            el("span", { class: "fine" }, event.home.short),
            ...MARKETS.filter((m) => markets[m]).flatMap((m) => {
              const [a, b] = m === "total" ? ["over", "under"] : ["away", "home"];
              return [
                el("span", { class: "fine" }, shortMarketLabel(event.sport, m)),
                el("span", {}, cell(m, book.markets[m], a)),
                el("span", {}, cell(m, book.markets[m], b))
              ];
            })
          ])
        ])
      )
    )
  ]);
}

let detailContainer = null;
let detailToken = 0;

function renderDetailBody() {
  hideTooltip();
  const { event, markets, bookSummaries, asOf } = state.view;
  const market = markets[state.market];
  const stale = bookSummaries.filter((b) => b.stale);

  const header = card(
    [
      el("p", { class: "eyebrow" }, leagueLabel(event)),
      el("h2", { class: "matchup" }, [
        el("span", {}, event.away.name),
        el("span", { class: "vs" }, event.neutral ? "vs" : "@"),
        el("span", {}, event.home.name)
      ]),
      el("p", { class: "fine" }, [dateTime(event.startTime), event.venue ? ` · ${event.venue}` : ""]),
      el("p", { class: "fine" }, [
        `Odds as of ${dateTime(asOf)} · ${bookSummaries.length} books`,
        stale.length ? el("span", { class: "neg" }, ` · ${stale.length} stale`) : null
      ]),
      event.notes?.length ? el("ul", { class: "notes", "aria-label": "Line movement notes" }, event.notes.map((n) => el("li", {}, n))) : null
    ],
    "game-header"
  );

  const tabs = segmented(
    ["moneyline", "spread", "total"].filter((m) => markets[m]).map((m) => [m, marketLabel(event.sport, m)]),
    state.market,
    (value) => {
      state.market = value;
      state.selection = null;
      renderDetailBody();
    },
    { label: "Market", className: "market-tabs" }
  );

  if (!market) {
    detailContainer.replaceChildren(header, tabs, card(el("p", { class: "muted" }, "No prices for this market.")));
    return;
  }
  detailContainer.replaceChildren(header, tabs, fairValue(event, market), compareTable(event, market), movementCard(event, market), bookCards(event));
  loadHistory(event, market, detailToken);
}

async function renderDetail(container, token, eventId) {
  detailContainer = container;
  detailToken = token;
  if (state.eventId !== eventId) {
    state.eventId = eventId;
    state.selection = null;
  }
  container.replaceChildren(card(el("p", { class: "muted" }, "Loading odds…")));
  let view;
  try {
    view = await api(`/api/events/${encodeURIComponent(eventId)}`);
  } catch (error) {
    if (isCurrent(token)) container.replaceChildren(card([el("h2", {}, "Game not found"), el("p", { class: "muted" }, error.message)], "empty-state"));
    return;
  }
  if (!isCurrent(token)) return;
  state.view = view;
  container.dataset.eventId = eventId;
  if (!view.markets[state.market]) state.market = Object.keys(view.markets)[0] || "moneyline";
  renderDetailBody();
}

// ---------- view ----------

// On desktop the list stays mounted while you move between games, so its
// scroll position survives and only the detail pane re-renders.
let mounted = null; // { layout, listPane, detailPane, sport }

function markSelected(listPane, eventId) {
  for (const cardNode of listPane.querySelectorAll(".game-card")) {
    cardNode.classList.toggle("selected", cardNode.dataset.eventId === eventId);
  }
}

export async function renderGames(view, token, { eventId }) {
  const isDesktop = matchMedia(DESKTOP).matches;
  setChrome({ title: eventId && !isDesktop ? "Game" : "Games", back: eventId && !isDesktop ? "#/games" : null });

  if (isDesktop && eventId && mounted && view.contains(mounted.layout) && mounted.sport === state.sport) {
    markSelected(mounted.listPane, eventId);
    // Already showing this game (e.g. the auto-opened first game): keep it.
    if (mounted.detailPane.dataset.eventId === eventId && state.view?.event.id === eventId) {
      detailToken = token; // later tab/selection changes must count as current
      return;
    }
    await renderDetail(mounted.detailPane, token, eventId);
    return;
  }

  const listPane = el("section", { class: "games-list", "aria-label": "Games" });
  const detailPane = el("section", { class: "game-detail", "aria-label": "Game detail" });
  const layout = el("div", { class: `games-layout${eventId ? " has-detail" : ""}` }, [listPane, detailPane]);
  view.replaceChildren(layout);
  mounted = null;

  const meta = await api("/api/meta");
  if (!isCurrent(token)) return;

  const loadList = async () => {
    // Always go through the router so the new list gets a fresh render token
    // (this closure's token goes stale once another game is opened).
    const chips = sportChips(meta, (sport) => {
      state.sport = sport;
      mounted = null;
      navigate("#/games");
    });
    listPane.replaceChildren(chips, el("div", { class: "game-list" }, card(el("p", { class: "muted" }, "Loading games…"))));
    const query = state.sport === "all" ? "" : `?sport=${state.sport}`;
    const { events } = await api(`/api/events${query}`);
    if (!isCurrent(token)) return;
    const selected = eventId || (isDesktop ? events[0]?.id : null);
    listPane.replaceChildren(
      chips,
      el(
        "div",
        { class: "game-list" },
        events.length ? events.map((e) => gameCard(e, selected)) : card(el("p", { class: "muted" }, "No games for this sport."))
      )
    );
    mounted = isDesktop ? { layout, listPane, detailPane, sport: state.sport } : null;
    // Desktop shows list and detail side by side; open the first game if none chosen.
    if (!eventId && isDesktop) {
      if (events.length) renderDetail(detailPane, token, events[0].id);
      else detailPane.replaceChildren(card(el("p", { class: "muted" }, "No games for this sport.")));
    }
  };

  if (eventId) renderDetail(detailPane, token, eventId);
  if (!eventId || isDesktop) await loadList();
}
