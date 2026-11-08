/** The researcher's landing guarantee (2026-11-08): a run that spends its
 *  whole call budget on tool rounds still ends with a written brief, because
 *  the loop spends one final tool-less call on it. Scripted faux engine — no
 *  network, no real model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	type FauxResponseFactory,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { RESEARCH_TURN_BUDGET, runResearcherAgent } from "../src/agent/subagents/researcher.ts";

const STOP_INSTRUCTION = "Your research budget is spent";

/** A scripted engine that searches until it is told the budget is spent. */
function budgetBurner(brief: string, seen: { budgetNotice: boolean; toolsRemoved: boolean }) {
	let searches = 0;
	const step: FauxResponseFactory = (context) => {
		const lastUser = [...context.messages].reverse().find((m) => m.role === "user");
		const toldToStop = lastUser?.role === "user"
			&& typeof lastUser.content === "string"
			&& lastUser.content.includes(STOP_INSTRUCTION);
		if (toldToStop) {
			seen.budgetNotice = true;
			seen.toolsRemoved = context.messages.some(
				(m) => m.role === "system" && Array.isArray(m.toolsRemoved) && m.toolsRemoved.length > 0,
			);
			return fauxAssistantMessage([fauxText(brief)]);
		}
		searches++;
		return fauxAssistantMessage(
			[fauxToolCall("web_search", { query: `facet ${searches}` }, { id: `s${searches}` })],
			{ stopReason: "toolUse" },
		);
	};
	return { script: Array.from({ length: RESEARCH_TURN_BUDGET + 2 }, (): FauxResponseStep => step), searches: () => searches };
}

describe("researcher call budget (researcher.ts)", () => {
	it("writes the brief from what it gathered when the budget runs out mid-search", async () => {
		const brief = "## Summary\nPartial-research brief.\n\n## Findings\n1. Something found.";
		const seen = { budgetNotice: false, toolsRemoved: false };
		const burner = budgetBurner(brief, seen);
		const faux = createFauxCore({});
		faux.setResponses(burner.script);

		const result = await runResearcherAgent("Question that needs deep research", {
			engine: { model: faux.getModel(), streamFn: faux.streamSimple },
		});

		assert.equal(result, brief, "the run lands a brief instead of discarding the research");
		assert.equal(burner.searches(), RESEARCH_TURN_BUDGET, "every budgeted call was spent on research first");
		assert.equal(faux.state.callCount, RESEARCH_TURN_BUDGET + 1, "exactly one extra call writes the brief");
		assert.equal(seen.budgetNotice, true, "the extra call is prompted with the budget notice");
		assert.equal(seen.toolsRemoved, true, "the extra call cannot search any more");
	});

	it("spends no extra call when the run stopped on a text answer", async () => {
		const brief = "## Summary\nAnswered within budget.";
		const seen = { budgetNotice: false, toolsRemoved: false };
		const burner = budgetBurner(brief, seen);
		const faux = createFauxCore({});
		// Two calls: one search, then a plain text answer well inside the budget.
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("web_search", { query: "q" }, { id: "s1" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText(brief)]),
		]);

		const result = await runResearcherAgent("Simple question", {
			engine: { model: faux.getModel(), streamFn: faux.streamSimple },
		});

		assert.equal(result, brief);
		assert.equal(faux.state.callCount, 2, "an answer already on the table is not re-billed");
		assert.equal(seen.budgetNotice, false);
		assert.equal(burner.searches(), 0);
	});
});
