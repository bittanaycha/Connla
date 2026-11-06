import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { readingKey, isWebUrl } from "../../core/library.ts";
import type { LibraryStore } from "../../core/ports.ts";
import { serverExecute } from "../tool-execute.ts";

/**
 * add_reading (reading-list wave): the teacher's ONE write into the
 * learner's reading list. The list is write-only from the lesson — the
 * teacher is never shown the items and has no read tool, by design.
 *
 * The tool still dedupes on title/URL so repeated recommendations in one
 * session do not stack rows.
 */

const addReadingInput = Type.Object({
	title: Type.String({
		minLength: 1,
		description: "Title of the book, article, paper, course, or other item",
	}),
	author: Type.Optional(Type.String({ description: "Author, publication, or site" })),
	url: Type.Optional(Type.String({ description: "Optional http(s) link to the item" })),
	note: Type.Optional(Type.String({ description: "One short line on why it is worth reading" })),
});

export function createAddReadingTool(ctx: {
	chatId: string;
	libraryStore?: Pick<LibraryStore, "listReading" | "addReading">;
}): AgentTool<typeof addReadingInput> {
	return {
		name: "add_reading",
		label: "add_reading",
		description:
			"Add one book, article, paper, course, or other reading item to the learner's reading list. " +
			"Write-only: the list is not shown back to you and there is no tool to read it. " +
			"Use it when the learner asks to save something for later, or when you recommend one specific text that is worth keeping. " +
			"No status, progress, or reading order — title, author, link, and a one-line note only.",
		parameters: addReadingInput,
		execute: serverExecute("add_reading", addReadingInput, async ({ title, author, url, note }) => {
			const store = ctx.libraryStore;
			if (!store) throw new Error("The reading list is unavailable in this context.");
			const cleanTitle = title.trim();
			if (!cleanTitle) throw new Error("The reading item needs a title.");
			const cleanUrl = url?.trim() ?? "";
			if (cleanUrl && !isWebUrl(cleanUrl)) {
				throw new Error("The link must be an http(s) URL. Omit it when there is no link.");
			}
			const key = readingKey(cleanTitle, cleanUrl);
			const existing = store
				.listReading()
				.find((entry) => readingKey(entry.title, entry.url) === key);
			if (existing) return { text: `Already on the reading list: “${existing.title}”.` };
			const entry = store.addReading({
				title: cleanTitle,
				author: author?.trim() ?? "",
				url: cleanUrl,
				note: note?.trim() ?? "",
				source: { chatId: ctx.chatId, messageId: null },
			});
			return { text: `Added to the reading list: “${entry.title}”.` };
		}),
	};
}
