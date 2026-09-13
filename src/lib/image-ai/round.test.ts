import assert from "node:assert/strict";
import test from "node:test";
import { ROUND_ASSET_LIMIT, classifyRound, remainingRoundCapacity } from "./round.ts";

test("no task means there is no round to restore", () => {
  assert.equal(classifyRound({ hasTask: false, assetCount: 0 }), "none");
  assert.equal(classifyRound({ hasTask: false, assetCount: 9 }), "none");
});

test("a task under the limit stays active so refresh keeps reusing it", () => {
  for (const assetCount of [0, 1, 3, 8]) {
    assert.equal(classifyRound({ hasTask: true, assetCount }), "active", `assetCount=${assetCount}`);
  }
});

test("a task at or over the limit is finished, so the next round must mint a new task", () => {
  assert.equal(classifyRound({ hasTask: true, assetCount: ROUND_ASSET_LIMIT }), "finished");
  assert.equal(classifyRound({ hasTask: true, assetCount: ROUND_ASSET_LIMIT + 1 }), "finished");
});

test("remaining capacity never goes negative", () => {
  assert.equal(remainingRoundCapacity(0), 9);
  assert.equal(remainingRoundCapacity(7), 2);
  assert.equal(remainingRoundCapacity(9), 0);
  assert.equal(remainingRoundCapacity(11), 0);
});
