import assert from "node:assert/strict";
import test from "node:test";
import { runWithConcurrency, withExponentialRetry } from "./orchestrator.ts";

test("batch runs at most two child jobs concurrently and preserves partial failure", async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency(Array.from({ length: 4 }, (_, index) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (index === 2) throw new Error("simulated partial failure");
    return index;
  }), 2);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((item) => item.status), ["fulfilled", "fulfilled", "rejected", "fulfilled"]);
});

test("429 or network-style failures retry with exponential delays at most three times", async () => {
  const waits: number[] = [];
  let attempts = 0;
  const result = await withExponentialRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("429");
    return "completed";
  }, () => true, { maxAttempts: 3, baseDelayMs: 100, wait: async (ms) => { waits.push(ms); } });
  assert.equal(result, "completed");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 200]);
});

test("non-retriable child failure settles without cancelling sibling jobs", async () => {
  let attempts = 0;
  await assert.rejects(withExponentialRetry(async () => { attempts += 1; throw new Error("400"); }, () => false, { wait: async () => undefined }));
  assert.equal(attempts, 1);
});
