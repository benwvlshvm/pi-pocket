/** The footer's speed metrics: a real stream window yields tokens per second, a buffered flush does not. */
import assert from "node:assert/strict";
import test from "node:test";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { projectStats } from "../src/server/projection.ts";
import type { StreamTiming } from "../src/server/timing.ts";

let id = 0;
function assistant(usage: Record<string, number>, timing?: StreamTiming): EntryRecord {
	return {
		id: ++id,
		conversationId: 1,
		kind: "pi.assistant",
		model: [{ usage, stopReason: "stop", ...(timing ? { pocketTiming: timing } : {}) }],
	} as unknown as EntryRecord;
}

test("a genuine stream window yields tokens per second and time to first token", () => {
	const stats = projectStats(undefined, [
		assistant(
			{ input: 10, output: 300, cacheRead: 0, cacheWrite: 0 },
			{ startedAt: 1000, firstTokenAt: 1500, endedAt: 3500 },
		),
	]);
	assert.equal(stats.ttftMs, 500);
	assert.equal(stats.tokensPerSec, 150);
});

test("a buffered flush measures no window and is not reported as an absurd rate", () => {
	const stats = projectStats(undefined, [
		assistant(
			{ input: 10, output: 24, cacheRead: 0, cacheWrite: 0 },
			{ startedAt: 1000, firstTokenAt: 1098, endedAt: 1099 },
		),
	]);
	assert.equal(stats.ttftMs, 98);
	assert.equal(stats.tokensPerSec, undefined);
});

test("responses without a timing stamp show nothing rather than guessing", () => {
	const stats = projectStats(undefined, [assistant({ input: 10, output: 100, cacheRead: 0, cacheWrite: 0 })]);
	assert.equal(stats.tokensPerSec, undefined);
	assert.equal(stats.ttftMs, undefined);
});
