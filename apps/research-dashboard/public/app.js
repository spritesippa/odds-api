// Markets view: event list, odds comparison, probabilities, line movement,
// and sportsbook cards. Talks only to this app's /api routes, so it works
// unchanged whether the server runs the mock or a live provider.

import { formatAmerican, formatPercent, formatPoint } from "/lib/odds-math.mjs";
import { lineChart, hideTooltip } from "/chart.js";
import { el, SPORT_LABELS } from "/dom.js";
import { initPicks, prefillPick, render as renderPicks } from "/picks.js";

const MARKET_LABELS = { moneyline: "Moneyline", spread: "Spread", total: "Total" };
const STALE_MINUTES = 15;
const THEME_KEY = "odds-research-dashboard:theme";

// Color follows the sportsbook, never its rank: known books get a fixed slot,
// unknown (live) books take the next free slot in first-seen order.
const BOOK_SLOTS = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars", "betrivers"];
const bookColorMap = new Map(BOOK_SLOTS.map((key, i) => [key, `var(--series-${i + 1})`]));
function bookColor(key) {
  if (!bookColorMap.has(key)) {
    const slot = bookColorMap.size + 1;
    bookColorMap.set(key, slot <= 8 ? `var(--series-${slot})` : "var(--muted)");
  }
  return bookColorMap.get(key);
}

const state = {
  meta: null,
  sport: "all",
  events: [],
  selectedId: null,
  view: null,
  market: "moneyline",
  historySelection: null
};

async function api(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

// ---------- formatting ----------

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric" });

function relativeTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const text =
    mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function minutesAgo(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

const signedPct = (v, digits = 1) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${formatPercent(v, digits)}`);

function leagueLabel(event) {
  const sport = SPORT_LABELS[event.sport] || event.sport;
  return event.league && event.league !== sport ? `${sport} · ${event.league}` : sport;
}

function matchup(event) {
  return event.neutral ? `${event.home.name} vs ${event.away.name}` : `${event.away.name} @ ${event.home.name}`;
}

function outcomeLabel(market, outcome) {
  if (market === "moneyline") return outcome.name;
  if (market === "spread") return `${outcome.name} ${formatPoint(outcome.point)}`;
  return outcome.name;
}

function selectionTitle(event, market, selection) {
  if (selection === "draw") return "Draw";
  if (selection === "over") return "Over";
  if (selection === "under") return "Under";
  return event[selection].name;
}

// ---------- header / banner ----------

function renderMeta() {
  const { provider, disclaimer } = state.meta;
  document.getElementById("provider-line").textContent = provider.live
    ? `Live data · ${provider.label}`
    : "Mock data · no API key · no network calls to odds providers";
  const banner = document.getElementById("data-banner");
  banner.replaceChildren(
    provider.live
      ? el("span", {}, [el("strong", {}, "Live data. "), "Prices change quickly — confirm at the sportsbook before acting."])
      : el("span", {}, [
          el("strong", {}, "Mock data. "),
          "Every price, line, and movement on this page is invented for research and UI testing. Set ODDS_API_KEY on the server to switch to live data."
        ])
  );
  document.getElementById("disclaimer").textContent = disclaimer;
}

function renderSportFilter() {
  const sports = [{ key: "all", label: "All sports" }, ...state.meta.sports];
  document.getElementById("sport-filter").replaceChildren(
    ...sports.map((sport) =>
      el(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-pressed": String(state.sport === sport.key),
          onclick: () => {
            state.sport = sport.key;
            renderSportFilter();
            loadEvents();
          }
        },
        sport.label
      )
    )
  );
}

// ---------- event list ----------

async function loadEvents() {
  const list = document.getElementById("event-list");
  list.style.opacity = "0.6";
  try {
    const query = state.sport === "all" ? "" : `?sport=${encodeURIComponent(state.sport)}`;
    const { events } = await api(`/api/events${query}`);
    state.events = events;
    renderEventList();
    if (!events.some((e) => e.id === state.selectedId)) {
      if (events.length) selectEvent(events[0].id);
      else renderDetailEmpty("No upcoming events for this filter.");
    }
  } catch (error) {
    list.replaceChildren(el("div", { class: "card" }, `Could not load events: ${error.message}`));
  } finally {
    list.style.opacity = "";
  }
}

function renderEventList() {
  const list = document.getElementById("event-list");
  if (!state.events.length) {
    list.replaceChildren(el("div", { class: "card muted" }, "No events."));
    return;
  }
  list.replaceChildren(
    ...state.events.map((event) => {
      const s = event.summary || {};
      const ml = s.moneyline || {};
      const lines = [];
      if (s.spread !== undefined && s.spread !== null) lines.push(`Spread ${event.home.short} ${formatPoint(s.spread)}`);
      if (s.total !== undefined && s.total !== null) lines.push(`Total ${s.total}`);
      if (ml.draw) lines.push(`Draw ${formatAmerican(ml.draw.price)}`);
      return el(
        "button",
        {
          type: "button",
          class: "event-card",
          "aria-current": String(event.id === state.selectedId),
          onclick: () => selectEvent(event.id)
        },
        [
          el("div", { class: "event-meta" }, [
            el("span", { class: "league-tag" }, leagueLabel(event)),
            el("span", {}, relativeTime(event.startTime))
          ]),
          el("div", { class: "event-teams" }, [
            el("span", {}, event.away.name),
            el("span", { class: "num" }, ml.away ? formatAmerican(ml.away.price) : ""),
            el("span", {}, `${event.neutral ? "vs " : "@ "}${event.home.name}`),
            el("span", { class: "num" }, ml.home ? formatAmerican(ml.home.price) : "")
          ]),
          el("div", { class: "event-lines" }, [
            ...lines.map((text) => el("span", {}, text)),
            event.notes?.length ? el("span", { class: "moved" }, "Line moved") : null
          ])
        ]
      );
    })
  );
}

// ---------- event detail ----------

function renderDetailEmpty(message) {
  document.getElementById("event-detail").replaceChildren(el("div", { class: "card muted" }, message));
}

async function selectEvent(eventId) {
  state.selectedId = eventId;
  renderEventList();
  const detail = document.getElementById("event-detail");
  detail.style.opacity = "0.6";
  try {
    state.view = await api(`/api/events/${encodeURIComponent(eventId)}`);
    if (!state.view.markets[state.market]) state.market = Object.keys(state.view.markets)[0] || "moneyline";
    state.historySelection = null;
    renderDetail();
  } catch (error) {
    renderDetailEmpty(`Could not load odds: ${error.message}`);
  } finally {
    detail.style.opacity = "";
  }
}

function renderDetail() {
  const { event, asOf, markets } = state.view;
  const detail = document.getElementById("event-detail");
  const market = markets[state.market];
  const stale = state.view.bookSummaries.filter((b) => minutesAgo(b.updatedAt) > STALE_MINUTES);

  const head = el("div", { class: "card" }, [
    el("div", { class: "detail-head" }, [
      el("div", {}, [
        el("p", { class: "subtle" }, leagueLabel(event)),
        el("h2", {}, matchup(event)),
        el("p", { class: "subtle" }, [dateFmt.format(new Date(event.startTime)), ` (${relativeTime(event.startTime)})`, event.venue ? ` · ${event.venue}` : ""])
      ]),
      el("div", { class: "subtle" }, [
        `Odds as of ${dateFmt.format(new Date(asOf))}`,
        el("br"),
        stale.length ? el("span", { class: "bad" }, `${stale.length} book(s) not updated in ${STALE_MINUTES}+ min`) : `${state.view.bookSummaries.length} sportsbooks`
      ])
    ]),
    event.notes?.length ? el("ul", { class: "notes", "aria-label": "Line movement notes" }, event.notes.map((n) => el("li", {}, n))) : null
  ]);

  const tabs = el(
    "div",
    { class: "market-tabs", role: "toolbar", "aria-label": "Market" },
    Object.keys(MARKET_LABELS)
      .filter((key) => markets[key])
      .map((key) =>
        el(
          "button",
          {
            type: "button",
            class: "chip",
            "aria-pressed": String(state.market === key),
            onclick: () => {
              state.market = key;
              state.historySelection = null;
              renderDetail();
            }
          },
          MARKET_LABELS[key]
        )
      )
  );

  if (!market) {
    detail.replaceChildren(head, tabs, el("div", { class: "card muted" }, "No prices for this market."));
    return;
  }

  detail.replaceChildren(
    head,
    tabs,
    renderFairValue(event, market),
    renderComparisonTable(event, market),
    renderMovementCard(event, market),
    renderBookCards(event)
  );
  loadHistory(event, market);
}

function renderFairValue(event, market) {
  const cards = market.selections.map((selection) => {
    const best = market.best[selection];
    const consensus = market.consensus[selection];
    const edge = best.edgeVsConsensus;
    return el("div", { class: "selection-card" }, [
      el("div", { class: "name" }, [
        selectionTitle(event, market.market, selection),
        consensus.point !== null && consensus.point !== undefined ? ` ${market.market === "spread" ? formatPoint(consensus.point) : consensus.point}` : ""
      ]),
      el("div", { class: "stat-row" }, [
        el("span", {}, [
          el("span", { class: "big-price num" }, formatAmerican(best.price)),
          best.point !== null && best.point !== consensus.point ? el("span", { class: "subtle" }, ` at ${formatPoint(best.point)}`) : ""
        ]),
        el("span", { class: best.stale ? "bad" : "label" }, `best · ${best.bookName}${best.stale ? " (stale)" : ""}`)
      ]),
      el("div", { class: "prob-bar", role: "img", "aria-label": `Implied ${formatPercent(best.implied)}, no-vig consensus ${formatPercent(consensus.noVig)}` }, [
        el("span", { class: "implied", style: { width: `${best.implied * 100}%` } }),
        el("span", { class: "fair", style: { width: `${consensus.noVig * 100}%` } })
      ]),
      el("div", { class: "stat-row" }, [el("span", { class: "label" }, "Implied (best price)"), el("span", { class: "num" }, formatPercent(best.implied))]),
      el("div", { class: "stat-row" }, [el("span", { class: "label" }, "No-vig consensus"), el("span", { class: "num" }, formatPercent(consensus.noVig))]),
      el("div", { class: "stat-row" }, [el("span", { class: "label" }, "Fair price"), el("span", { class: "num" }, formatAmerican(consensus.fairPrice))]),
      consensus.sharpNoVig !== null
        ? el("div", { class: "stat-row" }, [el("span", { class: "label" }, "Pinnacle no-vig"), el("span", { class: "num" }, formatPercent(consensus.sharpNoVig))])
        : null,
      el("div", { class: "stat-row" }, [
        el("span", { class: "label" }, "Best price vs consensus"),
        el("span", { class: `num ${edge > 0 ? "good" : ""}` }, edge === null ? "different line" : signedPct(edge))
      ]),
      best.stale || edge > 0.05
        ? el("p", { class: "subtle bad" }, "Unusually large gap — likely a stale or soon-to-move price. Verify before trusting it.")
        : null
    ]);
  });

  return el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h3", {}, "Best available & fair value"),
      el("span", { class: "subtle" }, `Avg hold ${formatPercent(market.avgHold)} · consensus of ${market.rows.filter((r) => r.line === market.consensusLine && !r.stale).length} books`)
    ]),
    el("div", { class: "legend" }, [
      el("span", { class: "key" }, [el("span", { class: "swatch box", style: { background: "var(--axis)" } }), "Implied probability (includes vig)"]),
      el("span", { class: "key" }, [el("span", { class: "swatch box", style: { background: "var(--series-1)" } }), "No-vig probability (vig removed, averaged)"])
    ]),
    el("div", { class: "selection-grid" }, cards),
    el(
      "p",
      { class: "subtle" },
      "No-vig = each book's implied probabilities scaled to sum to 100%, then averaged across books at the consensus line (books not updated in 15+ minutes are excluded). A positive “vs consensus” figure means the price beats the market average — it is an estimate, not a guaranteed edge."
    )
  ]);
}

function renderComparisonTable(event, market) {
  const header = el("tr", {}, [
    el("th", {}, "Sportsbook"),
    ...market.selections.map((s) => el("th", { class: "num" }, selectionTitle(event, market.market, s))),
    el("th", { class: "num" }, "Hold"),
    el("th", { class: "num" }, "Updated")
  ]);
  const rows = market.rows.map((row) =>
    el("tr", {}, [
      el("td", {}, [el("span", { class: "book-dot", style: { background: bookColor(row.book) } }), " ", row.bookName]),
      ...row.outcomes.map((o) =>
        el("td", { class: "num" }, [
          el(
            "button",
            {
              type: "button",
              class: `price-btn ${o.isBest ? "best" : ""}`,
              title: "Add to picks tracker",
              "aria-label": `${outcomeLabel(market.market, o)} ${formatAmerican(o.price)} at ${row.bookName}${o.isBest ? ", best available" : ""}. Add to picks.`,
              onclick: () => addToPicks(event, market.market, o, row.bookName)
            },
            [
              el("span", { class: "p" }, [o.point !== null ? `${market.market === "spread" ? formatPoint(o.point) : o.point} ` : "", formatAmerican(o.price)]),
              el("span", { class: "sub" }, `${formatPercent(o.implied)} · nv ${formatPercent(o.noVig)}`),
              o.isBest ? el("span", { class: "best-flag" }, "★ best") : null
            ]
          )
        ])
      ),
      el("td", { class: `num ${row.book === market.lowHold ? "good" : ""}` }, formatPercent(row.hold)),
      el("td", { class: `num ${row.stale ? "bad" : "muted"}` }, `${minutesAgo(row.updatedAt)}m ago${row.stale ? " · stale" : ""}`)
    ])
  );
  return el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h3", {}, `${MARKET_LABELS[market.market]} comparison`),
      el("span", { class: "subtle" }, "Price · implied % · no-vig (nv) %. ★ = best for the bettor. Click a price to log a pick.")
    ]),
    el("div", { class: "table-scroll" }, el("table", {}, [el("thead", {}, header), el("tbody", {}, rows)]))
  ]);
}

function renderMovementCard(event, market) {
  if (!state.historySelection || !market.selections.includes(state.historySelection)) {
    state.historySelection = market.selections.includes("home") ? "home" : market.selections[0];
  }
  const picker = el(
    "div",
    { class: "segmented", role: "toolbar", "aria-label": "Selection for line movement" },
    market.selections.map((selection) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(state.historySelection === selection),
          onclick: () => {
            state.historySelection = selection;
            renderDetail();
          }
        },
        selectionTitle(event, market.market, selection)
      )
    )
  );
  return el("div", { class: "card", id: "movement-card" }, [
    el("div", { class: "section-head" }, [el("h3", {}, "Line movement"), picker]),
    el("p", { class: "subtle" }, "Implied probability of this selection's price at each book over time (higher = shorter price)."),
    el("div", { class: "legend", id: "movement-legend" }),
    el("div", { class: "chart", id: "movement-chart" }),
    market.market !== "moneyline" ? el("h3", {}, market.market === "spread" ? "Spread line over time" : "Total line over time") : null,
    market.market !== "moneyline" ? el("div", { class: "chart", id: "movement-points" }) : null,
    el("div", { class: "table-scroll", id: "movement-table" })
  ]);
}

async function loadHistory(event, market) {
  const selection = state.historySelection;
  const chart = document.getElementById("movement-chart");
  try {
    const history = await api(
      `/api/events/${encodeURIComponent(event.id)}/history?market=${market.market}&selection=${selection}`
    );
    if (state.selectedId !== event.id || state.market !== market.market || state.historySelection !== selection) return;
    renderHistory(event, market, history);
  } catch (error) {
    chart.replaceChildren(el("div", { class: "chart-empty" }, `No line history available: ${error.message}`));
  }
}

function renderHistory(event, market, history) {
  const toSeries = (fn) =>
    history.series.map((s) => ({
      id: s.book,
      name: s.name,
      color: bookColor(s.book),
      points: s.points.map((p) => ({ x: new Date(p.t).getTime(), y: fn(p), raw: p }))
    }));
  const implied = (p) => (p.price > 0 ? 100 / (p.price + 100) : -p.price / (-p.price + 100));

  document.getElementById("movement-legend").replaceChildren(
    ...history.series.map((s) =>
      el("span", { class: "key" }, [el("span", { class: "swatch", style: { background: bookColor(s.book) } }), s.name])
    )
  );

  const xFormat = (x, long) => (long ? dateFmt.format(new Date(x)) : shortFmt.format(new Date(x)));
  const title = `${selectionTitle(event, market.market, history.selection)} ${MARKET_LABELS[market.market].toLowerCase()}`;

  lineChart(document.getElementById("movement-chart"), {
    series: toSeries(implied),
    step: true,
    yFormat: (v) => `${(v * 100).toFixed(0)}%`,
    xFormat,
    tooltipFormat: (p) =>
      `${p.raw.point !== null && p.raw.point !== undefined ? `${market.market === "spread" ? formatPoint(p.raw.point) : p.raw.point} ` : ""}${formatAmerican(p.raw.price)} (${formatPercent(p.y)})`,
    height: 240,
    ariaLabel: `Line movement for ${title}, implied probability by sportsbook`,
    directLabels: history.series.length <= 4
  });

  const pointsChart = document.getElementById("movement-points");
  if (pointsChart) {
    lineChart(pointsChart, {
      series: toSeries((p) => p.point ?? 0),
      step: true,
      yFormat: (v) => (market.market === "spread" ? formatPoint(Math.round(v * 2) / 2) : String(Math.round(v * 2) / 2)),
      xFormat,
      tooltipFormat: (p) => `${market.market === "spread" ? formatPoint(p.raw.point) : p.raw.point} (${formatAmerican(p.raw.price)})`,
      height: 150,
      yPadding: 0.5,
      ariaLabel: `${title} line by sportsbook over time`
    });
  }

  const rows = history.perBook.map((b) => {
    const fmtLine = (p) => `${p.point !== null ? `${market.market === "spread" ? formatPoint(p.point) : p.point} ` : ""}${formatAmerican(p.price)}`;
    return el("tr", {}, [
      el("td", {}, [el("span", { class: "book-dot", style: { background: bookColor(b.book) } }), " ", b.name]),
      el("td", { class: "num" }, fmtLine(b.open)),
      el("td", { class: "num" }, fmtLine(b.current)),
      el("td", { class: "num" }, signedPct(b.impliedMove)),
      market.market !== "moneyline" ? el("td", { class: "num" }, b.pointMove ? formatPoint(b.pointMove) : "0") : null
    ]);
  });
  document.getElementById("movement-table").replaceChildren(
    el("table", {}, [
      el(
        "thead",
        {},
        el("tr", {}, [
          el("th", {}, "Sportsbook"),
          el("th", { class: "num" }, "Open"),
          el("th", { class: "num" }, "Current"),
          el("th", { class: "num" }, "Δ implied"),
          market.market !== "moneyline" ? el("th", { class: "num" }, "Δ line") : null
        ])
      ),
      el("tbody", {}, rows)
    ])
  );
}

function renderBookCards(event) {
  const { markets, bookSummaries } = state.view;
  const lowestHold = bookSummaries.reduce((low, b) => (b.avgHold !== null && (low === null || b.avgHold < low.avgHold) ? b : low), null);
  const mostBest = bookSummaries.reduce((top, b) => (b.bestCount > (top?.bestCount ?? 0) ? b : top), null);

  const lineCell = (market, outcomes, selection) => {
    const o = outcomes?.find((x) => x.selection === selection);
    if (!o) return "–";
    if (market === "moneyline") return formatAmerican(o.price);
    const pt = market === "spread" ? formatPoint(o.point) : `${selection === "over" ? "o" : "u"}${o.point}`;
    return `${pt} ${formatAmerican(o.price)}`;
  };

  const cards = bookSummaries.map((book) => {
    const rows = [];
    for (const market of Object.keys(MARKET_LABELS)) {
      if (!markets[market]) continue;
      const [a, b] = market === "total" ? ["over", "under"] : ["away", "home"];
      rows.push(
        el("span", { class: "mk" }, MARKET_LABELS[market]),
        el("span", {}, lineCell(market, book.markets[market], a)),
        el("span", {}, lineCell(market, book.markets[market], b))
      );
    }
    return el("div", { class: "book-card" }, [
      el("header", {}, [
        el("h4", {}, [el("span", { class: "book-dot", style: { background: bookColor(book.book) } }), book.name]),
        el("span", { class: `subtle ${minutesAgo(book.updatedAt) > STALE_MINUTES ? "bad" : ""}` }, `${minutesAgo(book.updatedAt)}m ago`)
      ]),
      el("div", { class: "legend" }, [
        book === lowestHold ? el("span", { class: "badge good-badge" }, "Lowest hold") : null,
        book === mostBest && book.bestCount > 0 ? el("span", { class: "badge good-badge" }, "Most best prices") : null,
        el("span", { class: "badge" }, `Avg hold ${formatPercent(book.avgHold)}`),
        el("span", { class: "badge" }, `Best on ${book.bestCount} selection${book.bestCount === 1 ? "" : "s"}`)
      ]),
      el("div", { class: "book-lines" }, [
        el("span", { class: "mk" }, ""),
        el("span", { class: "mk" }, event.neutral ? event.away.short : event.away.short),
        el("span", { class: "mk" }, event.home.short),
        ...rows
      ])
    ]);
  });

  return el("div", { class: "card" }, [
    el("div", { class: "section-head" }, [
      el("h3", {}, "Sportsbook comparison"),
      el("span", { class: "subtle" }, "Lower hold = less margin built into prices. Totals columns read over / under.")
    ]),
    el("div", { class: "book-grid" }, cards)
  ]);
}

function addToPicks(event, market, outcome, bookName) {
  const selection =
    market === "moneyline"
      ? outcome.name
      : market === "spread"
        ? `${event[outcome.selection].short} ${formatPoint(outcome.point)}`
        : `${outcome.selection === "over" ? "Over" : "Under"} ${outcome.point}`;
  showView("picks");
  prefillPick({
    date: new Date().toISOString().slice(0, 10),
    sport: event.sport,
    event: matchup(event),
    market,
    selection,
    price: outcome.price,
    book: bookName
  });
}

// ---------- shell ----------

function showView(view) {
  hideTooltip();
  for (const tab of document.querySelectorAll(".tab")) tab.setAttribute("aria-pressed", String(tab.dataset.view === view));
  document.getElementById("view-markets").hidden = view !== "markets";
  document.getElementById("view-picks").hidden = view !== "picks";
  if (view === "picks") renderPicks();
  else if (state.view) renderDetail();
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current =
      document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
    showView(document.getElementById("view-picks").hidden ? "markets" : "picks");
  });
}

async function init() {
  initTheme();
  for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => showView(tab.dataset.view));
  initPicks();
  try {
    state.meta = await api("/api/meta");
  } catch (error) {
    document.getElementById("provider-line").textContent = `Could not reach the dashboard API: ${error.message}`;
    return;
  }
  renderMeta();
  renderSportFilter();
  await loadEvents();
}

init();
