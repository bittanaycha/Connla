import assert from "node:assert/strict";
import test from "node:test";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { createProberTools } from "../src/agent/tools.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";

test("the probe phase carries maps, pronunciation, and direct-request guidance", () => {
	const ctx = {
		chatId: "synthetic",
		chatStore: { getChat: () => null } as unknown as ChatStore,
		jobStore: {} as JobStore,
		spawn: () => {},
		deliver: () => {},
	};
	const tools = createProberTools(ctx);
	assert.ok(tools.map, "map is registered for the prober");

	const prompt = composeInstructions("prober");
	assert.match(prompt, /## Maps/);
	assert.match(prompt, /## Pronunciation/);
	assert.match(prompt, /## Direct requests/);
});
