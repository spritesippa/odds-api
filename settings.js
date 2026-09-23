// Settings: display preferences, bankroll units, local data tools, and info.

import { getMeta, isCurrent, setChrome, toast } from "./app.js";
import { card, confirmButton, el, sectionHead, segmented } from "./dom.js";
import { pickProfit } from "./lib/odds-math.mjs";
import { BET_TYPE_LABELS, LIMITS, PICK_SPORTS, clearPicks, getPicks, getSettings, resetToSamples, sortedPicks, updateSettings } from "./store.js";
import { formatAmerican } from "./lib/odds-math.mjs";

function csvCell(value) {
  let text = String(value ?? "");
  // Neutralize spreadsheet formulas in free-text fields.
  if (/^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function picksCsv() {
  const header = ["date", "sport", "matchup", "bet_type", "selection", "odds", "stake_units", "result", "profit_units", "sportsbook", "notes"];
  const rows = sortedPicks().map((p) =>
    [p.date, PICK_SPORTS[p.sport], p.matchup, BET_TYPE_LABELS[p.betType], p.selection, formatAmerican(p.odds), p.stake, p.result, pickProfit(p).toFixed(2), p.book, p.notes]
      .map(csvCell)
      .join(",")
  );
  return { text: [header.join(","), ...rows].join("\n"), count: rows.length };
}

/** Copy CSV to the clipboard; if that's refused, show it selected for manual copy. */
function copyCsv(fallbackBox) {
  const { text, count } = picksCsv();
  const showFallback = () => {
    fallbackBox.hidden = false;
    fallbackBox.value = text;
    fallbackBox.focus();
    fallbackBox.select();
    toast("Select all and copy the CSV below");
  };
  try {
    navigator.clipboard.writeText(text).then(() => toast(`Copied ${count} picks as CSV`), showFallback);
  } catch {
    showFallback();
  }
}

export async function renderSettings(view, token) {
  setChrome({ title: "Settings" });
  const rerender = () => isCurrent(token) && renderSettings(view, token);
  const settings = getSettings();

  const numberField = (id, label, value, hint, attrs, onCommit) =>
    el("div", { class: "field" }, [
      el("label", { for: id }, label),
      el("input", {
        id,
        type: "number",
        inputmode: "decimal",
        value: value || "",
        ...attrs,
        onchange: (e) => {
          onCommit(Number(e.target.value));
          toast("Saved");
        }
      }),
      el("p", { class: "hint" }, hint)
    ]);

  const pickCount = getPicks().length;
  const csvBox = el("textarea", { id: "csv-output", class: "csv-box", rows: 6, readonly: true, hidden: true, "aria-label": "Picks as CSV" });
  view.replaceChildren(
    card([
      sectionHead("Display"),
      el("div", { class: "field", role: "group", "aria-label": "Odds format" }, [
        el("span", { class: "label" }, "Odds format"),
        segmented(
          [
            ["american", "American (−110)"],
            ["decimal", "Decimal (1.91)"]
          ],
          settings.oddsFormat,
          (value) => {
            updateSettings({ oddsFormat: value });
            rerender();
          },
          { label: "Odds format" }
        ),
        el("p", { class: "hint" }, "Changes how prices display everywhere. You always enter pick odds in American format.")
      ])
    ]),
    card([
      sectionHead("Units"),
      numberField("s-unit", "Value of 1 unit ($)", settings.unitValue, "Optional. Shows dollar amounts next to unit totals.", { min: 0, step: 1 }, (v) =>
        updateSettings({ unitValue: v })
      ),
      numberField("s-stake", "Default stake (units)", settings.defaultStake, "Pre-filled when you add a pick.", { min: 0.01, max: LIMITS.maxStake, step: 0.01 }, (v) =>
        updateSettings({ defaultStake: v })
      )
    ]),
    card([
      sectionHead("Your data"),
      el("p", { class: "fine" }, `${pickCount} pick${pickCount === 1 ? "" : "s"} stored on this device only (browser storage). Nothing is uploaded.`),
      el("div", { class: "button-stack" }, [
        el("button", { type: "button", class: "btn", onclick: () => copyCsv(csvBox) }, "Copy picks as CSV"),
        confirmButton({
          content: "Reset to sample picks",
          armedText: "Tap again to replace all picks",
          onConfirm: () => {
            resetToSamples();
            toast("Sample picks restored");
            rerender();
          }
        }),
        confirmButton({
          content: "Delete all picks",
          armedText: "Tap again to delete every pick",
          className: "btn danger",
          onConfirm: () => {
            clearPicks();
            toast("All picks deleted");
            rerender();
          }
        })
      ]),
      csvBox
    ]),
    card([sectionHead("Data source"), el("p", { class: "muted", id: "source-text" }, "Loading…")]),
    card([
      sectionHead("About"),
      el(
        "p",
        { class: "fine" },
        "A research tool. It never places bets, logs into sportsbooks, scrapes websites, or automates any account."
      ),
      el("p", { class: "fine", id: "disclaimer" })
    ])
  );

  try {
    const meta = await getMeta();
    if (!isCurrent(token)) return;
    document.getElementById("source-text").textContent = meta.provider.live
      ? `Live data from ${meta.provider.label}. Prices change quickly — confirm at the sportsbook.`
      : "Mock data. Every game, price, and line move is invented. No API key is set and the app makes no requests to odds providers.";
    document.getElementById("disclaimer").textContent = meta.disclaimer;
  } catch (error) {
    if (isCurrent(token)) document.getElementById("source-text").textContent = `Could not load: ${error.message}`;
  }
}
