// Dashboard: your record at a glance, biggest line moves, best prices vs the
// market, stale-price alerts, and the next games up.

import { api, isCurrent, setChrome } from "/app.js";
import { card, el, icon, sectionHead, SPORT_LABELS } from "/dom.js";
import { formatPoint, kickoff, lineText, marketLabel, odds, signedPct, tone } from "/format.js";
import { summarizePicks } from "/lib/odds-math.mjs";
import { getPicks } from "/store.js";
import { statTiles } from "/picks.js";

function shortMatchup(event) {
  return event.neutral ? `${event.home.short} vs ${event.away.short}` : `${event.away.short} @ ${event.home.short}`;
}

function rowLink(href, children) {
  return el("a", { class: "list-row", href }, [...children, icon("chevron")]);
}

function moverRow(item, event) {
  const chips = [];
  const { moneyline, spread, total } = item.moves;
  if (moneyline) {
    chips.push(
      el("span", { class: "move-chip" }, [
        `${event[moneyline.selection].short} ${odds(moneyline.open)} → ${odds(moneyline.current)}`,
        el("span", { class: tone(moneyline.impliedMove) }, ` ${signedPct(moneyline.impliedMove)}`)
      ])
    );
  }
  if (spread) chips.push(el("span", { class: "move-chip" }, `${marketLabel(event.sport, "spread")} ${event.home.short} ${formatPoint(spread.open)} → ${formatPoint(spread.current)}`));
  if (total) chips.push(el("span", { class: "move-chip" }, `${marketLabel(event.sport, "total")} ${total.open} → ${total.current}`));
  return rowLink(`#/games/${event.id}`, [
    el("div", { class: "row-body" }, [
      el("div", { class: "row-title" }, [el("span", { class: "tag" }, SPORT_LABELS[event.sport]), shortMatchup(event)]),
      el("div", { class: "move-chips" }, chips)
    ])
  ]);
}

function gapRow(gap, event) {
  const line = lineText(gap.market, gap.selection, gap.point);
  const name =
    gap.selection === "home" || gap.selection === "away"
      ? event[gap.selection].short
      : gap.selection === "draw"
        ? "Draw"
        : `${gap.selection === "over" ? "Over" : "Under"} ${gap.point}`;
  return rowLink(`#/games/${event.id}`, [
    el("div", { class: "row-body" }, [
      el("div", { class: "row-title" }, [el("span", { class: "tag" }, SPORT_LABELS[event.sport]), `${name}${line && gap.market === "spread" ? ` ${line}` : ""}`]),
      el("div", { class: "fine" }, `${marketLabel(event.sport, gap.market)} · ${shortMatchup(event)} · ${gap.book}${gap.stale ? " (stale)" : ""}`)
    ]),
    el("div", { class: "row-end" }, [
      el("span", { class: "row-price" }, odds(gap.price)),
      el("span", { class: `fine ${gap.stale ? "neg" : tone(gap.edge)}` }, gap.stale ? "stale" : `${signedPct(gap.edge)} vs fair ${odds(gap.fairPrice)}`)
    ])
  ]);
}

function upNextRow(event) {
  const ml = event.summary?.markets?.moneyline?.selections || {};
  return rowLink(`#/games/${event.id}`, [
    el("div", { class: "row-body" }, [
      el("div", { class: "row-title" }, [el("span", { class: "tag" }, SPORT_LABELS[event.sport]), shortMatchup(event)]),
      el("div", { class: "fine" }, `${kickoff(event.startTime)} · ${event.league}`)
    ]),
    el("div", { class: "row-end" }, [
      el("span", { class: "fine" }, `${event.away.short} ${ml.away ? odds(ml.away.price) : "–"}`),
      el("span", { class: "fine" }, `${event.home.short} ${ml.home ? odds(ml.home.price) : "–"}`)
    ])
  ]);
}

export async function renderDashboard(view, token) {
  setChrome({ title: "Dashboard" });
  const stats = summarizePicks(getPicks());

  const record = card([
    sectionHead("Your picks", el("a", { class: "text-link", href: "#/picks" }, "All picks")),
    statTiles(stats, { compact: true }),
    stats.pending ? el("a", { class: "fine text-link", href: "#/picks" }, `${stats.pending} pending pick${stats.pending === 1 ? "" : "s"} to settle`) : null
  ]);
  const placeholder = (title) => card([sectionHead(title), el("p", { class: "muted" }, "Loading…")]);
  view.replaceChildren(record, placeholder("Biggest line moves"), placeholder("Best prices vs market"), placeholder("Up next"));

  const [meta, insights, list] = await Promise.all([api("/api/meta"), api("/api/insights"), api("/api/events")]);
  if (!isCurrent(token)) return;
  const byId = new Map(list.events.map((e) => [e.id, e]));

  const movers = insights.movers.filter((m) => byId.has(m.eventId));
  const gaps = insights.gaps.filter((g) => byId.has(g.eventId)).slice(0, 5);
  const staleNote = insights.stale.length
    ? el("p", { class: "fine neg" }, `${insights.stale.length} sportsbook price${insights.stale.length === 1 ? " is" : "s are"} stale (not updated in 15+ min). Stale prices often look like value but get pulled or limited.`)
    : null;

  view.replaceChildren(
    meta.provider.live
      ? null
      : el("p", { class: "banner" }, [el("strong", {}, "Mock data. "), "All games, prices, and line moves are invented for research and testing."]),
    record,
    card([
      sectionHead("Biggest line moves", el("span", { class: "fine" }, "Sharpest book, open → now")),
      movers.length ? el("div", { class: "list" }, movers.map((m) => moverRow(m, byId.get(m.eventId)))) : el("p", { class: "muted" }, "No notable moves.")
    ]),
    card([
      sectionHead("Best prices vs market", el("span", { class: "fine" }, "vs no-vig fair odds")),
      gaps.length ? el("div", { class: "list" }, gaps.map((g) => gapRow(g, byId.get(g.eventId)))) : el("p", { class: "muted" }, "No prices beat the market right now."),
      staleNote,
      el("p", { class: "fine" }, "An estimate, not a guaranteed edge. Odds move and limits apply.")
    ]),
    card([
      sectionHead("Up next", el("a", { class: "text-link", href: "#/games" }, "All games")),
      el("div", { class: "list" }, list.events.slice(0, 5).map(upNextRow))
    ])
  );
}
