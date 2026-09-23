// Pure odds math shared by the server (analysis) and the browser (picks tracker).
// No I/O, no dependencies. Served to the browser as /lib/odds-math.mjs.

/** American odds -> decimal odds. */
export function americanToDecimal(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0 || (a > -100 && a < 100)) {
    throw new RangeError(`Invalid American odds: ${american}`);
  }
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

/** Decimal odds -> American odds (rounded to the nearest whole number). */
export function decimalToAmerican(decimal) {
  const d = Number(decimal);
  if (!Number.isFinite(d) || d <= 1) {
    throw new RangeError(`Invalid decimal odds: ${decimal}`);
  }
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

/** Implied probability (0-1) of American odds, including the book's vig. */
export function impliedProbability(american) {
  return 1 / americanToDecimal(american);
}

/** Probability (0-1) -> American odds, optionally rounded to a step (e.g. 5). */
export function probabilityToAmerican(probability, step = 1) {
  const p = Number(probability);
  if (!(p > 0 && p < 1)) throw new RangeError(`Invalid probability: ${probability}`);
  let american = p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p;
  american = Math.round(american / step) * step;
  if (american > -100 && american < 100) american = p >= 0.5 ? -100 : 100;
  return american;
}

/** Sum of implied probabilities minus 1, i.e. the book's margin (hold). */
export function marketHold(americanPrices) {
  const total = americanPrices.reduce((sum, price) => sum + impliedProbability(price), 0);
  return total - 1;
}

/**
 * Remove the vig from a complete market (2-way or 3-way) using the
 * multiplicative (proportional) method. Returns probabilities summing to 1.
 */
export function noVigProbabilities(americanPrices) {
  const implied = americanPrices.map(impliedProbability);
  const total = implied.reduce((sum, p) => sum + p, 0);
  return implied.map((p) => p / total);
}

/** Expected value per 1 unit staked, given a true probability and a price. */
export function expectedValue(probability, american) {
  return probability * americanToDecimal(american) - 1;
}

/** Profit (in units) for a winning bet of `stake` units at `american` odds. */
export function winProfit(stake, american) {
  return stake * (americanToDecimal(american) - 1);
}

export const PICK_RESULTS = ["pending", "win", "loss", "push"];
export const BET_TYPES = ["moneyline", "spread", "total", "prop", "parlay"];

/** Profit/loss of a single pick in units. Pending and push are 0. */
export function pickProfit(pick) {
  const stake = Number(pick.stake) || 0;
  if (pick.result === "win") return winProfit(stake, pick.odds);
  if (pick.result === "loss") return -stake;
  return 0;
}

/**
 * Aggregate picks into tracker stats.
 * - Win rate = wins / (wins + losses); pushes don't count either way.
 * - Units risked = stake on settled picks (win, loss, push).
 * - ROI = profit / units risked.
 */
export function summarizePicks(picks) {
  const stats = {
    total: picks.length,
    pending: 0,
    win: 0,
    loss: 0,
    push: 0,
    unitsRisked: 0,
    unitsPending: 0,
    profit: 0,
    winRate: null,
    roi: null
  };
  for (const pick of picks) {
    const stake = Number(pick.stake) || 0;
    if (!PICK_RESULTS.includes(pick.result)) continue;
    stats[pick.result] += 1;
    if (pick.result === "pending") stats.unitsPending += stake;
    else stats.unitsRisked += stake;
    stats.profit += pickProfit(pick);
  }
  const decided = stats.win + stats.loss;
  stats.winRate = decided > 0 ? stats.win / decided : null;
  stats.roi = stats.unitsRisked > 0 ? stats.profit / stats.unitsRisked : null;
  return stats;
}

/** Break-even win rate for a given price (equals its implied probability). */
export function breakEvenRate(american) {
  return impliedProbability(american);
}

export function formatAmerican(american) {
  const a = Math.round(Number(american));
  return a > 0 ? `+${a}` : `${a}`;
}

export function formatPoint(point) {
  if (point === null || point === undefined) return "";
  const p = Number(point);
  if (p === 0) return "PK";
  return p > 0 ? `+${p}` : `${p}`;
}

/** Decimal odds string for display, e.g. 1.91. */
export function formatDecimal(american) {
  return americanToDecimal(american).toFixed(2);
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}
