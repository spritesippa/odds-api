// Personal picks tracker. Picks are mock/research entries stored only in this
// browser. Nothing here places, sends, or syncs a bet anywhere.

import { isCurrent, navigate, setChrome, toast } from "./app.js";
import { lineChart } from "./chart.js";
import { card, confirmButton, el, icon, sectionHead, segmented } from "./dom.js";
import { formatPercent, money, odds, pickDate, signedPct, tone, units } from "./format.js";
import { BET_TYPES, PICK_RESULTS, breakEvenRate, pickProfit, summarizePicks, winProfit } from "./lib/odds-math.mjs";
import {
  BET_TYPE_LABELS,
  LIMITS,
  PICK_SPORTS,
  RESULT_LABELS,
  deletePick,
  getPicks,
  getSettings,
  isValidOdds,
  localDateString,
  newPickId,
  savePick,
  setResult,
  sortedPicks
} from "./store.js";

const filters = { result: "all", sport: "all" };
let prefill = null;

/** Called by the Games view before navigating to #/picks/new. */
export function setPickPrefill(values) {
  prefill = values;
}

// ---------- summary ----------

export function statTiles(stats, { compact = false } = {}) {
  const tile = (label, value, sub, cls = "") =>
    el("div", { class: "stat-tile" }, [
      el("span", { class: "stat-label" }, label),
      el("span", { class: `stat-value ${cls}` }, value),
      sub ? el("span", { class: "stat-sub" }, sub) : null
    ]);
  const dollars = money(stats.profit, { signed: true });
  return el("div", { class: `stat-grid${compact ? " compact" : ""}` }, [
    tile("Profit / loss", units(stats.profit, { signed: true }), dollars || `${stats.win + stats.loss + stats.push} settled`, tone(stats.profit)),
    tile("ROI", stats.roi === null ? "–" : signedPct(stats.roi), "Profit ÷ units risked", tone(stats.roi ?? 0)),
    tile("Win rate", formatPercent(stats.winRate), `${stats.win}W · ${stats.loss}L · ${stats.push}P`),
    tile("Units risked", units(stats.unitsRisked), `${units(stats.unitsPending)} pending (${stats.pending})`)
  ]);
}

function plChart(list) {
  const settled = sortedPicks(list).filter((p) => p.result !== "pending");
  let running = 0;
  const points = settled.map((pick, i) => {
    running += pickProfit(pick);
    return { x: i + 1, y: running, pick };
  });
  if (points.length) points.unshift({ x: 0, y: 0, pick: null });
  const container = el("div", { class: "chart" });
  const body = card([
    sectionHead("Profit / loss over time", el("span", { class: `fine ${tone(running)}` }, units(running, { signed: true }))),
    container
  ]);
  requestAnimationFrame(() =>
    lineChart(container, {
      series: [{ id: "pl", name: "Cumulative P/L", color: "var(--accent)", points }],
      yFormat: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}u`,
      // Ticks are pick numbers; label them "#n" so repeated dates don't collide.
      xFormat: (x, long) => {
        const point = points[Math.round(x)];
        if (!point?.pick) return "Start";
        return long ? `#${point.x} · ${pickDate(point.pick.date)} · ${point.pick.selection}` : `#${point.x}`;
      },
      tooltipFormat: (p) => `${units(p.y, { signed: true })}${p.pick ? ` · ${RESULT_LABELS[p.pick.result]}` : ""}`,
      zeroLine: true,
      height: 190,
      ariaLabel: `Cumulative profit and loss over ${settled.length} settled picks, ending at ${units(running, { signed: true })}`,
      emptyText: "Settle a pick to start the profit/loss line."
    })
  );
  return body;
}

// ---------- list ----------

function pickCard(pick, rerender) {
  const pl = pickProfit(pick);
  const toWin = winProfit(pick.stake, pick.odds);
  return el("article", { class: `pick-card result-${pick.result}` }, [
    el("div", { class: "pick-top" }, [
      el("span", { class: "pick-meta" }, [
        el("span", { class: "tag" }, PICK_SPORTS[pick.sport]),
        el("span", { class: "tag" }, BET_TYPE_LABELS[pick.betType]),
        el("span", { class: "fine" }, pickDate(pick.date))
      ]),
      el("span", { class: `result-pill ${pick.result}` }, RESULT_LABELS[pick.result])
    ]),
    el("div", { class: "pick-main" }, [el("span", { class: "pick-selection" }, pick.selection), el("span", { class: "pick-odds" }, odds(pick.odds))]),
    el("p", { class: "pick-matchup" }, [pick.matchup, pick.book ? el("span", { class: "muted" }, ` · ${pick.book}`) : null]),
    el("div", { class: "pick-money" }, [
      el("span", {}, [el("span", { class: "muted" }, "Stake "), units(pick.stake)]),
      el("span", {}, [el("span", { class: "muted" }, "To win "), units(toWin)]),
      el("span", { class: `pick-pl ${tone(pl)}` }, pick.result === "pending" ? "Open" : units(pl, { signed: true }))
    ]),
    pick.notes ? el("p", { class: "pick-notes" }, pick.notes) : null,
    el("div", { class: "pick-actions" }, [
      segmented(
        PICK_RESULTS.map((r) => [r, RESULT_LABELS[r]]),
        pick.result,
        (value) => {
          setResult(pick.id, value);
          rerender();
        },
        { label: `Result for ${pick.selection}`, className: "result-seg" }
      ),
      el("a", { class: "icon-btn", href: `#/picks/edit/${pick.id}`, "aria-label": `Edit ${pick.selection}` }, icon("edit")),
      confirmButton({
        content: icon("trash"),
        armedText: "Delete?",
        label: `Delete ${pick.selection}`,
        className: "icon-btn delete-btn",
        onConfirm: () => {
          deletePick(pick.id);
          toast("Pick deleted");
          rerender();
        }
      })
    ])
  ]);
}

export function renderPicks(view, token) {
  setChrome({ title: "Picks" });
  const rerender = () => isCurrent(token) && renderPicks(view, token);
  const all = getPicks();
  const bySport = all.filter((p) => filters.sport === "all" || p.sport === filters.sport);
  const shown = sortedPicks(bySport)
    .filter((p) => filters.result === "all" || p.result === filters.result)
    .reverse();
  const stats = summarizePicks(bySport);

  const sportSelect = el(
    "select",
    {
      class: "select",
      "aria-label": "Filter by sport",
      onchange: (e) => {
        filters.sport = e.target.value;
        rerender();
      }
    },
    [["all", "All sports"], ...Object.entries(PICK_SPORTS)].map(([k, v]) => el("option", { value: k, selected: filters.sport === k }, v))
  );

  view.replaceChildren(
    el("a", { class: "btn primary block", href: "#/picks/new" }, [icon("plus"), "Add pick"]),
    statTiles(stats),
    plChart(bySport),
    el("div", { class: "filter-bar" }, [
      el(
        "div",
        { class: "chips scroll-x", role: "group", "aria-label": "Filter by result" },
        [["all", "All"], ...PICK_RESULTS.map((r) => [r, RESULT_LABELS[r]])].map(([k, label]) =>
          el(
            "button",
            {
              type: "button",
              class: "chip",
              "aria-pressed": String(filters.result === k),
              onclick: () => {
                filters.result = k;
                rerender();
              }
            },
            k === "all" ? `${label} (${bySport.length})` : `${label} (${stats[k]})`
          )
        )
      ),
      sportSelect
    ]),
    shown.length
      ? el("div", { class: "pick-list" }, shown.map((p) => pickCard(p, rerender)))
      : card(
          [
            el("p", { class: "muted" }, all.length ? "No picks match these filters." : "No picks yet."),
            all.length ? null : el("a", { class: "btn", href: "#/picks/new" }, "Add your first pick")
          ],
          "empty-state"
        )
  );
}

// ---------- form ----------

const SELECTION_HINTS = {
  moneyline: "e.g. Buffalo Bills",
  spread: "e.g. Bills -3",
  total: "e.g. Over 46.5",
  prop: "e.g. Josh Allen over 1.5 passing TDs",
  parlay: "e.g. Bills ML / Lakers +4.5 / Over 8.5"
};

export function renderPickForm(view, token, { id }) {
  const existing = id ? getPicks().find((p) => p.id === id) : null;
  if (id && !existing) {
    setChrome({ title: "Edit pick", back: "#/picks" });
    view.replaceChildren(card([el("h2", {}, "Pick not found"), el("a", { class: "btn", href: "#/picks" }, "Back to picks")], "empty-state"));
    return;
  }
  setChrome({ title: existing ? "Edit pick" : "Add pick", back: "#/picks" });

  const settings = getSettings();
  const initial = existing
    ? { ...existing }
    : {
        date: localDateString(),
        sport: "nfl",
        matchup: "",
        betType: "moneyline",
        selection: "",
        odds: -110,
        stake: settings.defaultStake,
        result: "pending",
        book: "",
        notes: "",
        ...(prefill || {})
      };
  prefill = null;

  // Odds are entered as a sign toggle + a number, because phone number pads
  // often have no minus key.
  const form = { ...initial, sign: initial.odds < 0 ? -1 : 1, magnitude: Math.abs(initial.odds) };

  const errorBox = el("p", { class: "form-error", role: "alert", hidden: true });
  const preview = el("div", { class: "preview", "aria-live": "polite" });

  const currentOdds = () => form.sign * Math.round(Number(form.magnitude));
  const currentStake = () => Math.round(Number(form.stake) * 100) / 100;

  function updatePreview() {
    const o = currentOdds();
    const s = currentStake();
    if (!isValidOdds(o) || !(s > 0)) {
      preview.replaceChildren(el("span", { class: "muted" }, "Enter odds (±100 or more) and a stake to see the payout."));
      return;
    }
    const win = winProfit(s, o);
    const pl = pickProfit({ stake: s, odds: o, result: form.result });
    const cell = (label, value, cls = "") => el("div", {}, [el("span", { class: "stat-label" }, label), el("span", { class: `preview-value ${cls}` }, value)]);
    preview.replaceChildren(
      cell("To win", units(win)),
      cell("Total return", units(win + s)),
      cell("Break-even", formatPercent(breakEvenRate(o))),
      cell(form.result === "pending" ? "P/L if it wins" : "P/L", units(form.result === "pending" ? win : pl, { signed: true }), tone(form.result === "pending" ? win : pl))
    );
  }

  const input = (name, attrs = {}) =>
    el("input", {
      name,
      id: `f-${name}`,
      value: form[name] ?? "",
      oninput: (e) => {
        form[name] = e.target.value;
        updatePreview();
      },
      ...attrs
    });
  const field = (label, control, hint) =>
    el("div", { class: "field" }, [el("label", { for: control.id || undefined }, label), control, hint ? el("p", { class: "hint" }, hint) : null]);
  const groupField = (label, control) => el("div", { class: "field", role: "group", "aria-label": label }, [el("span", { class: "label" }, label), control]);

  const selectionInput = input("selection", { required: true, maxlength: LIMITS.selection, placeholder: SELECTION_HINTS[form.betType], autocomplete: "off" });

  const betTypeSeg = segmented(
    BET_TYPES.map((t) => [t, BET_TYPE_LABELS[t]]),
    form.betType,
    (value) => {
      form.betType = value;
      selectionInput.placeholder = SELECTION_HINTS[value];
      for (const b of betTypeSeg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
      oddsHint.textContent = value === "parlay" ? "Enter the combined parlay odds." : "";
    },
    { label: "Bet type", className: "wrap" }
  );
  const oddsHint = el("p", { class: "hint" }, form.betType === "parlay" ? "Enter the combined parlay odds." : "");

  const signSeg = segmented(
    [
      [1, "+"],
      [-1, "−"]
    ],
    form.sign,
    (value) => {
      form.sign = value;
      for (const b of signSeg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(Number(b.dataset.value) === value));
      updatePreview();
    },
    { label: "Odds sign", className: "sign" }
  );
  const oddsInput = input("magnitude", { id: "f-odds", type: "number", inputmode: "numeric", min: 100, step: 1, required: true, "aria-label": "American odds (without sign)" });

  const stakeInput = input("stake", { type: "number", inputmode: "decimal", min: 0.01, max: LIMITS.maxStake, step: 0.01, required: true });
  const stakeChips = el(
    "div",
    { class: "chips" },
    [0.5, 1, 2, 3].map((v) =>
      el(
        "button",
        {
          type: "button",
          class: "chip",
          onclick: () => {
            form.stake = v;
            stakeInput.value = v;
            updatePreview();
          }
        },
        `${v}u`
      )
    )
  );

  const resultSeg = segmented(
    PICK_RESULTS.map((r) => [r, RESULT_LABELS[r]]),
    form.result,
    (value) => {
      form.result = value;
      for (const b of resultSeg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === value));
      updatePreview();
    },
    { label: "Result", className: "result-seg" }
  );

  const sportSelect = el(
    "select",
    { id: "f-sport", class: "select", onchange: (e) => (form.sport = e.target.value) },
    Object.entries(PICK_SPORTS).map(([k, v]) => el("option", { value: k, selected: form.sport === k }, v))
  );

  function onSubmit(e) {
    e.preventDefault();
    const o = currentOdds();
    const s = currentStake();
    const problems = [];
    if (!String(form.matchup).trim()) problems.push("Enter the matchup.");
    if (!String(form.selection).trim()) problems.push("Enter your selection.");
    if (!isValidOdds(o)) problems.push("American odds must be a whole number of 100 or more, with + or −.");
    if (!(s > 0 && s <= LIMITS.maxStake)) problems.push(`Stake must be between 0.01 and ${LIMITS.maxStake} units.`);
    if (problems.length) {
      errorBox.textContent = problems.join(" ");
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const saved = savePick({
      id: existing?.id || newPickId(),
      date: form.date || localDateString(),
      sport: form.sport,
      matchup: form.matchup,
      betType: form.betType,
      selection: form.selection,
      odds: o,
      stake: s,
      result: form.result,
      book: form.book,
      notes: form.notes
    });
    if (!saved) {
      errorBox.textContent = "Couldn't save this pick. Check the fields and try again.";
      errorBox.hidden = false;
      return;
    }
    toast(existing ? "Pick updated" : "Pick added");
    navigate("#/picks");
  }

  view.replaceChildren(
    el("form", { class: "pick-form card", novalidate: true, onsubmit: onSubmit }, [
      el("p", { class: "fine" }, "Mock pick for your own tracking. Stored only on this device; no bet is placed."),
      field("Sport", sportSelect),
      field("Matchup", input("matchup", { required: true, maxlength: LIMITS.matchup, placeholder: "e.g. Chiefs @ Bills", autocomplete: "off" })),
      groupField("Bet type", betTypeSeg),
      field("Selection", selectionInput),
      el("div", { class: "field" }, [
        el("label", { for: "f-odds" }, "American odds"),
        el("div", { class: "odds-input" }, [signSeg, oddsInput]),
        oddsHint
      ]),
      el("div", { class: "field" }, [el("label", { for: "f-stake" }, "Stake (units)"), stakeInput, stakeChips]),
      groupField("Result", resultSeg),
      preview,
      field("Notes", el("textarea", { id: "f-notes", name: "notes", rows: 3, maxlength: LIMITS.notes, placeholder: "Why you like it (optional)", oninput: (e) => (form.notes = e.target.value) }, form.notes || "")),
      el("details", { class: "more" }, [
        el("summary", {}, "Date & sportsbook"),
        field("Date", input("date", { type: "date" })),
        field("Sportsbook (optional)", input("book", { maxlength: LIMITS.book, placeholder: "e.g. DraftKings", autocomplete: "off" }))
      ]),
      errorBox,
      el("div", { class: "form-buttons" }, [
        el("a", { class: "btn", href: "#/picks" }, "Cancel"),
        el("button", { type: "submit", class: "btn primary" }, existing ? "Save changes" : "Save pick")
      ])
    ])
  );
  updatePreview();
}
