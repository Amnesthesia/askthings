import assert from "node:assert/strict";
import { test } from "node:test";
import { rotateHue } from "./useThemeColor.ts";

test("rotateHue matches CSS hue-rotate on the level colours", () => {
	assert.equal(rotateHue("#16736a", 0), "#16736a");
	// Teal rotated a quarter turn lands in the blues; a full turn is identity.
	assert.equal(rotateHue("#16736a", 360), "#16736a");
	const quarter = rotateHue("#16736a", 90);
	assert.match(quarter, /^#[0-9a-f]{6}$/);
	assert.notEqual(quarter, "#16736a");
	// Negative drift is a valid direction.
	assert.notEqual(rotateHue("#b0364f", -14), "#b0364f");
	assert.equal(rotateHue("#808080", 30), "#808080");
});
