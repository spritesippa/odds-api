// Display formatting that depends on user settings (odds format, unit value).

import { formatAmerican, formatDecimal, formatPercent, formatPoint } from "/lib/odds-math.mjs";
import { getSettings } from "/store.js";

export { formatPercent, formatPoint };

/** Odds in the user's chosen format. Pick entry always stays American. */
export function odds(american) {
  return getSettings().oddsFormat === "decimal" ? formatDecimal(american) : formatAmerican(american);
}

export function units(value, { signed = false } = {}) {
  const v = Math.abs(value) < 0.005 ? 0 : value;
  return `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}u`;
}

/** Dollar equivalent of units, or "" when no unit value is set. */
export function money(unitsValue, { signed = false } = {}) {
  const { unitValue } = getSettings();
  if (!unitValue) return "";
  const dollars = unitsValue * unitValue;
  const sign = dollars < -0.005 ? "-" : signed && dollars > 0.005 ? "+" : "";
  return `${sign}$${Math.abs(dollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const signedPct = (v, digits = 1) =>
  v === null || v === undefined ? "–" : `${v > 0.00005 ? "+" : ""}${formatPercent(v, digits)}`;

export const tone = (v) => (v > 0.00005 ? "pos" : v < -0.00005 ? "neg" : "");

// Sport-specific market names, as a sportsbook would label them.
export function marketLabel(sport, market) {
  if (market === "moneyline") return sport === "soccer" ? "1X2" : "Moneyline";
  if (market === "spread") return { mlb: "Run line", soccer: "Handicap", nhl: "Puck line" }[sport] || "Spread";
  if (market === "total") return { ufc: "Total rounds", soccer: "Total goals", mlb: "Total runs" }[sport] || "Total";
  return market;
}

export function shortMarketLabel(sport, market) {
  if (market === "moneyline") return sport === "soccer" ? "1X2" : "Money";
  if (market === "spread") return { mlb: "Run line", soccer: "Handicap" }[sport] || "Spread";
  return sport === "ufc" ? "Rounds" : "Total";
}

/** "BUF -3", "o46.5", "u46.5" — the line part of a price button. */
export function lineText(market, selection, point) {
  if (point === null || point === undefined) return "";
  if (market === "spread") return formatPoint(point);
  if (market === "total") return `${selection === "under" ? "U" : "O"} ${point}`;
  return "";
}

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric" });

export const dateTime = (iso) => dateTimeFmt.format(new Date(iso));
export const shortDateTime = (ms) => shortFmt.format(new Date(ms));

/** "Today 7:10 PM", "Tomorrow 1:00 PM", "Sat, Sep 26 · 4:25 PM" */
export function kickoff(iso) {
  const date = new Date(iso);
  const today = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(today)) / 86400000);
  if (days === 0) return `Today ${timeFmt.format(date)}`;
  if (days === 1) return `Tomorrow ${timeFmt.format(date)}`;
  return `${dayFmt.format(date)} · ${timeFmt.format(date)}`;
}

/** Local calendar date "2026-09-22" -> "Sep 22". */
export function pickDate(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

export function minutesAgo(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function ago(iso) {
  const m = minutesAgo(iso);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
