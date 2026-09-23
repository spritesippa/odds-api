import assert from "node:assert/strict";
import test from "node:test";
import {
  americanToDecimal,
  decimalToAmerican,
  expectedValue,
  impliedProbability,
  marketHold,
  noVigProbabilities,
  pickProfit,
  probabilityToAmerican,
  summarizePicks
} from "../src/lib/odds-math.mjs";

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("American <-> decimal conversions", () => {
  close(americanToDecimal(-110), 1.909090);
  close(americanToDecimal(150), 2.5);
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.throws(() => americanToDecimal(50), RangeError);
  assert.throws(() => decimalToAmerican(1), RangeError);
});

test("implied probability", () => {
  close(impliedProbability(-110), 0.52381);
  close(impliedProbability(100), 0.5);
  close(impliedProbability(300), 0.25);
});

test("probabilityToAmerican rounds to a step and never lands inside (-100, 100)", () => {
  assert.equal(probabilityToAmerican(0.5238), -110);
  assert.equal(probabilityToAmerican(0.4, 5), 150);
  assert.equal(probabilityToAmerican(0.501, 5), -100);
  assert.equal(probabilityToAmerican(0.499, 5), 100);
});

test("hold and no-vig for a standard -110/-110 market", () => {
  close(marketHold([-110, -110]), 0.047619);
  const [a, b] = noVigProbabilities([-110, -110]);
  close(a, 0.5);
  close(b, 0.5);
});

test("no-vig for a three-way soccer market sums to 1", () => {
  const probs = noVigProbabilities([230, 270, 115]);
  close(probs.reduce((s, p) => s + p, 0), 1);
  assert.ok(probs[2] > probs[0] && probs[0] > probs[1]);
});

test("expected value", () => {
  close(expectedValue(0.5, 110), 0.05);
  close(expectedValue(0.5, -110), -0.045454);
});

test("pick profit by result", () => {
  close(pickProfit({ stake: 1, odds: -110, result: "win" }), 0.909090);
  close(pickProfit({ stake: 2, odds: 150, result: "win" }), 3);
  assert.equal(pickProfit({ stake: 1.5, odds: -110, result: "loss" }), -1.5);
  assert.equal(pickProfit({ stake: 1, odds: -110, result: "push" }), 0);
  assert.equal(pickProfit({ stake: 1, odds: -110, result: "pending" }), 0);
});

test("summarizePicks: win rate excludes pushes, ROI uses settled units", () => {
  const stats = summarizePicks([
    { stake: 1, odds: 100, result: "win" },
    { stake: 1, odds: -110, result: "loss" },
    { stake: 2, odds: -110, result: "push" },
    { stake: 3, odds: -110, result: "pending" }
  ]);
  assert.equal(stats.win, 1);
  assert.equal(stats.loss, 1);
  assert.equal(stats.push, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.winRate, 0.5);
  assert.equal(stats.unitsRisked, 4);
  assert.equal(stats.unitsPending, 3);
  assert.equal(stats.profit, 0);
  assert.equal(stats.roi, 0);
});

test("summarizePicks: parlay and prop picks count like any other pick", () => {
  const stats = summarizePicks([
    { stake: 0.5, odds: 596, result: "win", betType: "parlay" },
    { stake: 1, odds: -135, result: "loss", betType: "prop" }
  ]);
  close(stats.profit, 0.5 * 5.96 - 1);
  close(stats.roi, (0.5 * 5.96 - 1) / 1.5);
  assert.equal(stats.winRate, 0.5);
});

test("summarizePicks ignores unknown results and handles an empty list", () => {
  const empty = summarizePicks([]);
  assert.equal(empty.winRate, null);
  assert.equal(empty.roi, null);
  assert.equal(empty.profit, 0);
  const junk = summarizePicks([{ stake: 1, odds: -110, result: "won" }]);
  assert.equal(junk.unitsRisked, 0);
});
