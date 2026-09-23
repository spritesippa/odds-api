// Local-only persistence for picks and settings (localStorage). Nothing here
// is sent to the server or any third party. Every read is validated because
// storage can be edited by hand, cleared, or unavailable (private mode).

import { BET_TYPES, PICK_RESULTS } from "./lib/odds-math.mjs";
import { SPORT_LABELS } from "./dom.js";

const PICKS_KEY = "odds-research-dashboard:picks:v2";
const LEGACY_PICKS_KEY = "odds-research-dashboard:picks:v1";
const SETTINGS_KEY = "odds-research-dashboard:settings:v1";
const LEGACY_UNIT_KEY = "odds-research-dashboard:unit-value:v1";

export const PICK_SPORTS = { ...SPORT_LABELS, other: "Other" };
export const BET_TYPE_LABELS = { moneyline: "Moneyline", spread: "Spread", total: "Total", prop: "Prop", parlay: "Parlay" };
export const RESULT_LABELS = { pending: "Pending", win: "Win", loss: "Loss", push: "Push" };

export const LIMITS = { matchup: 120, selection: 120, notes: 300, book: 40, maxStake: 1000 };

const DEFAULT_SETTINGS = { oddsFormat: "american", unitValue: 0, defaultStake: 1 };

// Invented sample history so the tracker isn't empty on first run.
const SAMPLE_PICKS = [
  ["2026-09-06", "nfl", "Pittsburgh Steelers @ New York Jets", "spread", "Jets +2.5", -110, 1, "win", "DraftKings", ""],
  ["2026-09-07", "nfl", "Baltimore Ravens @ Cincinnati Bengals", "total", "Under 47.5", -108, 1, "loss", "FanDuel", ""],
  ["2026-09-07", "nfl", "Baltimore Ravens @ Cincinnati Bengals", "prop", "Joe Burrow over 1.5 passing TDs", -135, 0.5, "win", "BetMGM", "Player prop"],
  ["2026-09-08", "mlb", "Seattle Mariners @ Houston Astros", "moneyline", "Mariners", 128, 1, "win", "BetMGM", ""],
  ["2026-09-10", "mlb", "Chicago Cubs @ Milwaukee Brewers", "total", "Over 8", -105, 0.5, "push", "Caesars", "Landed exactly on 8"],
  ["2026-09-13", "nfl", "Los Angeles Rams @ San Francisco 49ers", "spread", "Rams +6.5", -112, 1, "win", "BetRivers", ""],
  ["2026-09-13", "soccer", "Chelsea vs Tottenham", "moneyline", "Draw", 260, 0.5, "loss", "FanDuel", ""],
  ["2026-09-14", "nfl", "Sunday 3-leg parlay", "parlay", "Rams +6.5 / Bills ML / Over 44.5", 596, 0.25, "loss", "DraftKings", "Missed on the total"],
  ["2026-09-14", "mlb", "Atlanta Braves @ New York Mets", "spread", "Braves -1.5", 145, 0.5, "loss", "DraftKings", ""],
  ["2026-09-16", "soccer", "Inter vs Juventus", "total", "Under 2.5", -120, 1, "win", "BetMGM", ""],
  ["2026-09-19", "ufc", "Ortega vs Lindqvist (fictional)", "moneyline", "Ortega", -165, 1.5, "win", "DraftKings", ""],
  ["2026-09-20", "nfl", "Green Bay Packers @ Minnesota Vikings", "moneyline", "Vikings", 115, 1, "loss", "Caesars", ""],
  ["2026-09-21", "mlb", "Philadelphia Phillies @ Miami Marlins", "moneyline", "Phillies", -150, 1.5, "win", "FanDuel", ""],
  ["2026-09-21", "nba", "Preseason: Miami Heat @ Orlando Magic", "prop", "Heat 1st quarter over 54.5", -110, 0.5, "push", "FanDuel", "Mock preseason example"],
  ["2026-09-22", "nfl", "Kansas City Chiefs @ Buffalo Bills", "spread", "Bills -3", -110, 1, "pending", "DraftKings", ""],
  ["2026-09-22", "nba", "Boston Celtics @ New York Knicks", "total", "Under 221.5", -110, 0.5, "pending", "Caesars", ""]
].map(([date, sport, matchup, betType, selection, odds, stake, result, book, notes], i) => ({
  id: `sample-${i + 1}`,
  createdAt: i,
  date,
  sport,
  matchup,
  betType,
  selection,
  odds,
  stake,
  result,
  book,
  notes
}));

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked: data lasts for this page view only
  }
}

export function isValidOdds(odds) {
  const n = Number(odds);
  return Number.isInteger(n) && Math.abs(n) >= 100 && Math.abs(n) <= 100000;
}

export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const text = (value, max) => String(value ?? "").trim().slice(0, max);

/** Returns a clean pick, or null if it can't be trusted. */
export function normalizePick(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pick = {
    id: text(raw.id, 80),
    createdAt: Number(raw.createdAt) || 0,
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : localDateString(),
    sport: PICK_SPORTS[raw.sport] ? raw.sport : "other",
    matchup: text(raw.matchup, LIMITS.matchup),
    betType: BET_TYPES.includes(raw.betType) ? raw.betType : null,
    selection: text(raw.selection, LIMITS.selection),
    odds: Number(raw.odds),
    stake: Math.round(Number(raw.stake) * 100) / 100,
    result: PICK_RESULTS.includes(raw.result) ? raw.result : null,
    book: text(raw.book, LIMITS.book),
    notes: text(raw.notes, LIMITS.notes)
  };
  if (!pick.id || !pick.betType || !pick.result || !pick.matchup || !pick.selection) return null;
  if (!isValidOdds(pick.odds) || !(pick.stake > 0 && pick.stake <= LIMITS.maxStake)) return null;
  return pick;
}

/** v1 picks (won/lost/void, event/market/price/units) -> v2 shape. */
function migrateLegacy(list) {
  const results = { won: "win", lost: "loss", push: "push", pending: "pending", void: "push" };
  const types = { moneyline: "moneyline", spread: "spread", total: "total", other: "prop" };
  return list.map((p) => ({
    id: p.id,
    createdAt: p.createdAt,
    date: p.date,
    sport: p.sport,
    matchup: p.event,
    betType: types[p.market] || "prop",
    selection: p.selection,
    odds: p.price,
    stake: p.units,
    result: results[p.result],
    book: p.book,
    notes: p.result === "void" ? `${p.notes ? `${p.notes} · ` : ""}Voided (refunded)` : p.notes
  }));
}

let picks = null;
let settings = null;
const listeners = new Set();

// Keep multiple open tabs in sync: another tab's write invalidates our cache
// and tells the app to re-render. (Local writes re-render their own view.)
window.addEventListener("storage", (event) => {
  if (event.key !== null && event.key !== PICKS_KEY && event.key !== SETTINGS_KEY) return;
  picks = null;
  settings = null;
  for (const fn of listeners) fn();
});

export function onExternalChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getPicks() {
  if (picks) return picks;
  let stored = read(PICKS_KEY);
  if (!Array.isArray(stored)) {
    const legacy = read(LEGACY_PICKS_KEY);
    stored = Array.isArray(legacy) ? migrateLegacy(legacy) : structuredClone(SAMPLE_PICKS);
    picks = stored.map(normalizePick).filter(Boolean);
    write(PICKS_KEY, picks);
  } else {
    picks = stored.map(normalizePick).filter(Boolean);
  }
  return picks;
}

function commit(next) {
  picks = next;
  write(PICKS_KEY, picks);
}

export function newPickId() {
  return `pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert or replace. Returns the saved pick, or null if invalid. */
export function savePick(raw) {
  const pick = normalizePick({ createdAt: Date.now(), ...raw });
  if (!pick) return null;
  const list = getPicks();
  const index = list.findIndex((p) => p.id === pick.id);
  if (index === -1) commit([...list, pick]);
  else {
    pick.createdAt = list[index].createdAt;
    commit(list.map((p, i) => (i === index ? pick : p)));
  }
  return pick;
}

export function setResult(id, result) {
  if (!PICK_RESULTS.includes(result)) return;
  commit(getPicks().map((p) => (p.id === id ? { ...p, result } : p)));
}

export function deletePick(id) {
  commit(getPicks().filter((p) => p.id !== id));
}

export function resetToSamples() {
  commit(structuredClone(SAMPLE_PICKS));
}

export function clearPicks() {
  commit([]);
}

/** Oldest first; ties keep entry order. */
export function sortedPicks(list = getPicks()) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export function getSettings() {
  if (settings) return settings;
  const stored = read(SETTINGS_KEY) || {};
  const legacyUnit = Number(read(LEGACY_UNIT_KEY)) || 0;
  settings = sanitizeSettings({ ...DEFAULT_SETTINGS, unitValue: legacyUnit, ...stored });
  return settings;
}

function sanitizeSettings(raw) {
  const unitValue = Number(raw.unitValue);
  const defaultStake = Number(raw.defaultStake);
  return {
    oddsFormat: raw.oddsFormat === "decimal" ? "decimal" : "american",
    unitValue: Number.isFinite(unitValue) && unitValue >= 0 && unitValue <= 1_000_000 ? unitValue : 0,
    defaultStake: defaultStake > 0 && defaultStake <= LIMITS.maxStake ? defaultStake : 1
  };
}

export function updateSettings(patch) {
  settings = sanitizeSettings({ ...getSettings(), ...patch });
  write(SETTINGS_KEY, settings);
  return settings;
}
