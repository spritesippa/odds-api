// Personal picks tracker. Picks live only in this browser (localStorage).
// This records research picks and outcomes; it never places bets.

import {
  PICK_RESULTS,
  formatAmerican,
  formatPercent,
  pickProfit,
  summarizePicks,
  winProfit
} from "/lib/odds-math.mjs";
import { lineChart } from "/chart.js";
import { el, SPORT_LABELS } from "/dom.js";

const STORAGE_KEY = "odds-research-dashboard:picks:v1";
const UNIT_KEY = "odds-research-dashboard:unit-value:v1";
const MARKET_LABELS = { moneyline: "Moneyline", spread: "Spread", total: "Total", other: "Other" };

// Sample history so the tracker isn't empty on first run. All invented.
const SAMPLE_PICKS = [
  { date: "2026-09-06", sport: "nfl", event: "Pittsburgh Steelers @ New York Jets", market: "spread", selection: "Jets +2.5", price: -110, units: 1, book: "DraftKings", result: "won" },
  { date: "2026-09-07", sport: "nfl", event: "Baltimore Ravens @ Cincinnati Bengals", market: "total", selection: "Under 47.5", price: -108, units: 1, book: "FanDuel", result: "lost" },
  { date: "2026-09-08", sport: "mlb", event: "Seattle Mariners @ Houston Astros", market: "moneyline", selection: "Mariners", price: 128, units: 1, book: "BetMGM", result: "won" },
  { date: "2026-09-10", sport: "mlb", event: "Chicago Cubs @ Milwaukee Brewers", market: "total", selection: "Over 8", price: -105, units: 0.5, book: "Caesars", result: "push", notes: "Landed on 8" },
  { date: "2026-09-13", sport: "nfl", event: "Los Angeles Rams @ San Francisco 49ers", market: "spread", selection: "Rams +6.5", price: -112, units: 1, book: "BetRivers", result: "won" },
  { date: "2026-09-13", sport: "soccer", event: "Chelsea vs Tottenham", market: "moneyline", selection: "Draw", price: 260, units: 0.5, book: "FanDuel", result: "lost" },
  { date: "2026-09-14", sport: "mlb", event: "Atlanta Braves @ New York Mets", market: "spread", selection: "Braves -1.5", price: 145, units: 0.5, book: "DraftKings", result: "lost" },
  { date: "2026-09-16", sport: "soccer", event: "Inter vs Juventus", market: "total", selection: "Under 2.5", price: -120, units: 1, book: "BetMGM", result: "won" },
  { date: "2026-09-18", sport: "nba", event: "Preseason: Miami Heat @ Orlando Magic", market: "total", selection: "Under 214.5", price: -110, units: 0.5, book: "FanDuel", result: "lost", notes: "Mock preseason example" },
  { date: "2026-09-19", sport: "ufc", event: "Ortega vs Lindqvist (fictional)", market: "moneyline", selection: "Ortega", price: -165, units: 1.5, book: "DraftKings", result: "won" },
  { date: "2026-09-20", sport: "nfl", event: "Green Bay Packers @ Minnesota Vikings", market: "moneyline", selection: "Vikings", price: 115, units: 1, book: "Caesars", result: "lost" },
  { date: "2026-09-21", sport: "mlb", event: "Philadelphia Phillies @ Miami Marlins", market: "moneyline", selection: "Phillies", price: -150, units: 1.5, book: "FanDuel", result: "won" },
  { date: "2026-09-21", sport: "ufc", event: "Kaya vs Brandt (fictional)", market: "moneyline", selection: "Brandt", price: 190, units: 0.5, book: "BetMGM", result: "void", notes: "Bout cancelled" },
  { date: "2026-09-23", sport: "nfl", event: "Kansas City Chiefs @ Buffalo Bills", market: "spread", selection: "Bills -3", price: -110, units: 1, book: "DraftKings", result: "pending" },
  { date: "2026-09-23", sport: "nba", event: "Boston Celtics @ New York Knicks", market: "total", selection: "Under 221.5", price: -110, units: 0.5, book: "Caesars", result: "pending" }
].map((pick, i) => ({ id: `sample-${i + 1}`, notes: "", createdAt: i, ...pick }));

let picks = [];
let unitValue = 0;
let sportFilter = "all";
let editingId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    picks = Array.isArray(parsed) ? parsed.filter(isValidPick) : structuredClone(SAMPLE_PICKS);
  } catch {
    picks = structuredClone(SAMPLE_PICKS);
  }
  try {
    unitValue = Number(localStorage.getItem(UNIT_KEY)) || 0;
  } catch {
    unitValue = 0;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {
    // Storage unavailable (private mode, blocked); picks last for this page view.
  }
}

function isValidPick(pick) {
  return (
    pick &&
    typeof pick.id === "string" &&
    PICK_RESULTS.includes(pick.result) &&
    isValidPrice(pick.price) &&
    Number(pick.units) > 0
  );
}

function isValidPrice(price) {
  const n = Number(price);
  return Number.isFinite(n) && Math.abs(n) >= 100;
}

const fmtUnits = (u, signed = false) => `${signed && u > 0 ? "+" : ""}${u.toFixed(2)}u`;
const fmtMoney = (units) => {
  if (!unitValue) return "";
  const dollars = units * unitValue;
  const sign = dollars < 0 ? "-" : dollars > 0 ? "+" : "";
  return `${sign}$${Math.abs(dollars).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

function sortedPicks() {
  return [...picks].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

function filteredPicks() {
  return sortedPicks().filter((p) => sportFilter === "all" || p.sport === sportFilter);
}

function renderKpis(stats) {
  const kpi = (label, value, sub, tone) =>
    el("div", { class: "kpi" }, [
      el("div", { class: "kpi-label" }, label),
      el("div", { class: `kpi-value ${tone || ""}` }, value),
      el("div", { class: "kpi-sub" }, sub || "")
    ]);
  const tone = (v) => (v > 0 ? "good" : v < 0 ? "bad" : "");
  document.getElementById("pick-kpis").replaceChildren(
    kpi("Record (W-L-P)", `${stats.won}-${stats.lost}-${stats.push}`, `${stats.void} void · ${stats.pending} pending`),
    kpi("Win rate", formatPercent(stats.winRate), "Wins ÷ (wins + losses)"),
    kpi("Units risked", fmtUnits(stats.unitsRisked), `Graded picks · ${fmtUnits(stats.unitsPending)} pending`),
    kpi("Profit / loss", fmtUnits(stats.profit, true), fmtMoney(stats.profit) || "Set a unit value for $", tone(stats.profit)),
    kpi("ROI", stats.roi === null ? "–" : `${stats.roi > 0 ? "+" : ""}${formatPercent(stats.roi)}`, "Profit ÷ units risked", tone(stats.roi))
  );
}

function renderChart(list) {
  const settled = list.filter((p) => p.result !== "pending" && p.result !== "void");
  let running = 0;
  const points = settled.map((pick, i) => {
    running += pickProfit(pick);
    return { x: i + 1, y: running, pick };
  });
  if (points.length) points.unshift({ x: 0, y: 0, pick: null });
  lineChart(document.getElementById("pl-chart"), {
    series: [{ id: "pl", name: "Cumulative P/L", color: "var(--series-1)", points }],
    yFormat: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}u`,
    xFormat: (x, long) => {
      const point = points[Math.round(x)];
      if (!point?.pick) return long ? "Start" : "Start";
      return long ? `#${point.x} · ${point.pick.date} · ${point.pick.selection}` : point.pick.date.slice(5);
    },
    tooltipFormat: (p) => `${p.y > 0 ? "+" : ""}${p.y.toFixed(2)}u${p.pick ? ` (${p.pick.result})` : ""}`,
    zeroLine: true,
    height: 220,
    ariaLabel: `Cumulative profit and loss across ${settled.length} graded picks, ending at ${running.toFixed(2)} units`,
    emptyText: "Grade a pick to see the profit/loss curve."
  });
}

function renderFilter() {
  const sports = ["all", ...Object.keys(SPORT_LABELS)];
  document.getElementById("pick-filter").replaceChildren(
    ...sports.map((key) =>
      el(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-pressed": String(sportFilter === key),
          onclick: () => {
            sportFilter = key;
            render();
          }
        },
        key === "all" ? "All sports" : SPORT_LABELS[key]
      )
    )
  );
}

function renderTable(list) {
  const table = document.getElementById("picks-table");
  const head = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, "Date"),
      el("th", {}, "Sport"),
      el("th", {}, "Event"),
      el("th", {}, "Pick"),
      el("th", {}, "Book"),
      el("th", { class: "num" }, "Odds"),
      el("th", { class: "num" }, "Units"),
      el("th", { class: "num" }, "To win"),
      el("th", {}, "Result"),
      el("th", { class: "num" }, "P/L"),
      el("th", {}, "")
    ])
  ]);
  const rows = [...list].reverse().map((pick) => {
    const pl = pickProfit(pick);
    const resultSelect = el(
      "select",
      {
        "aria-label": `Result for ${pick.selection}`,
        class: `result-${pick.result}`,
        onchange: (e) => {
          pick.result = e.target.value;
          save();
          render();
        }
      },
      PICK_RESULTS.map((r) => el("option", { value: r, selected: r === pick.result }, r[0].toUpperCase() + r.slice(1)))
    );
    return el("tr", {}, [
      el("td", { class: "num" }, pick.date),
      el("td", {}, SPORT_LABELS[pick.sport] || pick.sport),
      el("td", { title: pick.notes || "" }, pick.event),
      el("td", {}, `${MARKET_LABELS[pick.market] || pick.market}: ${pick.selection}`),
      el("td", {}, pick.book || "–"),
      el("td", { class: "num" }, formatAmerican(pick.price)),
      el("td", { class: "num" }, Number(pick.units).toFixed(2)),
      el("td", { class: "num" }, fmtUnits(winProfit(Number(pick.units), pick.price))),
      el("td", {}, resultSelect),
      el("td", { class: `num ${pl > 0 ? "good" : pl < 0 ? "bad" : ""}` }, pick.result === "pending" ? "–" : fmtUnits(pl, true)),
      el("td", {}, [
        el("button", { type: "button", class: "ghost", onclick: () => startEdit(pick.id) }, "Edit"),
        " ",
        el(
          "button",
          {
            type: "button",
            class: "ghost",
            "aria-label": `Delete pick ${pick.selection}`,
            onclick: () => {
              if (!confirm(`Delete pick "${pick.selection}"?`)) return;
              picks = picks.filter((p) => p.id !== pick.id);
              save();
              render();
            }
          },
          "Delete"
        )
      ])
    ]);
  });
  const body = el(
    "tbody",
    {},
    rows.length ? rows : [el("tr", {}, [el("td", { colspan: 11, class: "empty" }, "No picks yet. Add one above or from the Markets tab.")])]
  );
  table.replaceChildren(head, body);
}

function field(label, input, cls) {
  return el("label", { class: cls || "" }, [label, input]);
}

function buildForm() {
  const form = document.getElementById("pick-form");
  const today = new Date().toISOString().slice(0, 10);
  form.replaceChildren(
    field("Date", el("input", { type: "date", name: "date", required: true, value: today })),
    field(
      "Sport",
      el("select", { name: "sport" }, Object.entries(SPORT_LABELS).map(([k, v]) => el("option", { value: k }, v)))
    ),
    field("Event", el("input", { name: "event", required: true, maxlength: 120, placeholder: "Away @ Home" }), "wide"),
    field(
      "Market",
      el("select", { name: "market" }, Object.entries(MARKET_LABELS).map(([k, v]) => el("option", { value: k }, v)))
    ),
    field("Selection", el("input", { name: "selection", required: true, maxlength: 80, placeholder: "e.g. Bills -3" }), "wide"),
    field("Odds (American)", el("input", { name: "price", type: "number", required: true, step: 1, placeholder: "-110" })),
    field("Units", el("input", { name: "units", type: "number", required: true, min: 0.01, max: 100, step: 0.01, value: 1 })),
    field("Sportsbook", el("input", { name: "book", maxlength: 40, list: "book-options", placeholder: "Optional" })),
    field(
      "Result",
      el("select", { name: "result" }, PICK_RESULTS.map((r) => el("option", { value: r }, r[0].toUpperCase() + r.slice(1))))
    ),
    field("Notes", el("input", { name: "notes", maxlength: 200, placeholder: "Why you like it (optional)" }), "wide"),
    el("datalist", { id: "book-options" }, ["DraftKings", "FanDuel", "BetMGM", "Caesars", "BetRivers", "Pinnacle"].map((b) => el("option", { value: b }))),
    el("p", { class: "form-error", id: "pick-error", hidden: true }),
    el("div", { class: "form-buttons" }, [
      el("button", { type: "submit", class: "primary", id: "pick-submit" }, "Add pick"),
      el("button", { type: "button", class: "ghost", id: "pick-cancel", hidden: true, onclick: () => resetForm() }, "Cancel")
    ]),
    el("p", { class: "form-hint" }, "Tip: click any price on the Markets tab to prefill this form. Win rate excludes pushes and voids; ROI = profit ÷ units risked on graded picks.")
  );
  form.addEventListener("submit", onSubmit);
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const error = document.getElementById("pick-error");
  const price = Math.round(Number(data.price));
  const units = Number(data.units);
  const problem = !isValidPrice(price)
    ? "Odds must be American format: -100 or lower, or +100 or higher."
    : !(units > 0 && units <= 100)
      ? "Units must be between 0.01 and 100."
      : !data.event.trim() || !data.selection.trim()
        ? "Event and selection are required."
        : "";
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const pick = {
    id: editingId || `pick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date: data.date,
    sport: data.sport,
    event: data.event.trim(),
    market: data.market,
    selection: data.selection.trim(),
    price,
    units,
    book: data.book.trim(),
    result: data.result,
    notes: data.notes.trim(),
    createdAt: Date.now()
  };
  if (editingId) {
    const index = picks.findIndex((p) => p.id === editingId);
    pick.createdAt = picks[index].createdAt;
    picks[index] = pick;
  } else {
    picks.push(pick);
  }
  save();
  resetForm();
  render();
}

function setFormValues(values) {
  const form = document.getElementById("pick-form");
  for (const [name, value] of Object.entries(values)) {
    if (form.elements[name] && value !== undefined && value !== null) form.elements[name].value = value;
  }
}

function startEdit(id) {
  const pick = picks.find((p) => p.id === id);
  if (!pick) return;
  editingId = id;
  setFormValues(pick);
  document.getElementById("pick-form-title").textContent = "Edit pick";
  document.getElementById("pick-submit").textContent = "Save changes";
  document.getElementById("pick-cancel").hidden = false;
  document.getElementById("pick-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetForm() {
  editingId = null;
  document.getElementById("pick-form").reset();
  document.getElementById("pick-form").elements.date.value = new Date().toISOString().slice(0, 10);
  document.getElementById("pick-form-title").textContent = "Add a pick";
  document.getElementById("pick-submit").textContent = "Add pick";
  document.getElementById("pick-cancel").hidden = true;
  document.getElementById("pick-error").hidden = true;
}

/** Called from the Markets tab when a price is clicked. */
export function prefillPick(values) {
  resetForm();
  setFormValues({ units: 1, result: "pending", ...values });
  document.getElementById("pick-form").elements.units.focus();
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const header = ["date", "sport", "event", "market", "selection", "odds", "units", "book", "result", "profit_units", "notes"];
  const lines = sortedPicks().map((p) =>
    [p.date, p.sport, p.event, p.market, p.selection, formatAmerican(p.price), p.units, p.book, p.result, pickProfit(p).toFixed(2), p.notes]
      .map(csvCell)
      .join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const link = el("a", { href: URL.createObjectURL(blob), download: "picks.csv" });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function render() {
  const list = filteredPicks();
  renderFilter();
  renderKpis(summarizePicks(list));
  renderChart(list);
  renderTable(list);
}

export function initPicks() {
  load();
  buildForm();
  const unitInput = document.getElementById("unit-value");
  unitInput.value = unitValue || "";
  unitInput.addEventListener("input", () => {
    unitValue = Math.max(0, Number(unitInput.value) || 0);
    try {
      localStorage.setItem(UNIT_KEY, String(unitValue));
    } catch {
      // ignore
    }
    render();
  });
  document.getElementById("export-picks").addEventListener("click", exportCsv);
  document.getElementById("reset-picks").addEventListener("click", () => {
    if (!confirm("Replace all picks with the sample picks? Your picks in this browser will be removed.")) return;
    picks = structuredClone(SAMPLE_PICKS);
    save();
    render();
  });
  render();
}
