import assert from "node:assert/strict";
import { test } from "node:test";
import { costUsd, priceFor } from "./pricing.ts";
import { batches, itemsByIndex } from "./stage.ts";

test("itemsByIndex keys by the echoed index, ignores junk and out-of-range, keeps the first duplicate", () => {
	const json = {
		items: [
			{ index: 2, same: true },
			{ index: 0, same: false },
			{ index: 0, same: true },
			{ index: 7, same: true },
			{ index: -1 },
			"nonsense",
			null,
		],
	};
	const m = itemsByIndex(json, 3);
	assert.deepEqual([...m.keys()].sort(), [0, 2]);
	assert.equal(m.get(0)?.same, false);
	assert.equal(m.get(1), undefined);
	assert.equal(itemsByIndex({ nope: 1 }, 3).size, 0);
	assert.equal(itemsByIndex("[]", 3).size, 0);
});

test("batches splits evenly with a short tail", () => {
	assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
	assert.deepEqual(batches([], 2), []);
});

test("cost uses the price table and an unknown model is budgeted at the top rate", () => {
	// 1M input + 1M output on Sonnet 5 = $2 + $10.
	assert.equal(
		costUsd("claude-sonnet-5", {
			input: 1_000_000,
			output: 1_000_000,
			cached: 0,
		}),
		12,
	);
	assert.ok(
		priceFor("some-new-model").output >= priceFor("claude-opus-5").output,
	);
});
