import { AnkiConnectError, ankiDeckNames, probeAnkiConnect } from "@/src/server";

/** GET /api/anki/decks — whether AnkiConnect is up, and the deck names it sees. */
export async function GET() {
	if (!(await probeAnkiConnect())) {
		return Response.json({
			connected: false,
			decks: [],
			error: "AnkiConnect is not reachable. Open Anki and install the AnkiConnect add-on (code 2055492159).",
		});
	}
	try {
		return Response.json({ connected: true, decks: await ankiDeckNames() });
	} catch (error) {
		return Response.json({
			connected: false,
			decks: [],
			error:
				error instanceof AnkiConnectError
					? error.message
					: "AnkiConnect answered, but the deck list could not be read.",
		});
	}
}
