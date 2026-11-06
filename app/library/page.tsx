import { LibraryView } from "@/components/library-view";
import { stores } from "@/src/server";

// Dynamic like the home page: the lists are server-rendered on every
// navigation, so a definition generated in a session shows up immediately.
export const dynamic = "force-dynamic";

export default function LibraryPage() {
	return (
		<LibraryView
			initialGlossary={stores.libraryStore.listGlossary()}
			initialHighlights={stores.libraryStore.listHighlights()}
			initialReading={stores.libraryStore.listReading()}
		/>
	);
}
