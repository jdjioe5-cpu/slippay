import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBattery, BATTERY } from "./prove_vs_judge_benchmark.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expectedPath = path.join(__dirname, "expected_benchmark.json");
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf-8"));

test("prove_vs_judge_benchmark evaluates deterministically without model calls", () => {
  const summary = evaluateBattery();

  assert.equal(summary.cases, expected.cases, `Cases count should match committed fixture (${expected.cases})`);
  assert.equal(summary.correct, expected.expected_correct, `Correct count should match (${expected.expected_correct})`);
  assert.equal(summary.wrong.length, expected.expected_wrong, "Wrong cases list must be empty");
  assert.equal(summary.correct / summary.cases, expected.accuracy, "Accuracy must be 1.0 (100%)");

  for (const res of summary.results) {
    assert.equal(res.ok, true, `Predicate ${res.p} evaluated to ${res.got}, expected ${res.exp}`);
  }
});

test("prove_vs_judge_benchmark preserves battery test cases integrity", () => {
  assert.ok(Array.isArray(BATTERY), "BATTERY should be an array");
  assert.equal(BATTERY.length, 11, "BATTERY length should be 11");
  for (const item of BATTERY) {
    assert.ok(typeof item.p === "string", "Predicate must be string");
    assert.ok(typeof item.ctx === "object", "Context must be object");
    assert.ok(typeof item.exp === "boolean", "Expected result must be boolean");
  }
});
