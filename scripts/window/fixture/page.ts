/**
 * The driver. Every answer is normalised to `resolved` with its value or `rejected` with the page-side error's fields, because the difference between a typed failure and a rejected invoke is what this proof documents. Helpers in `page-prelude.ts`.
 */
import { PAGE_PRELUDE } from "./page-prelude.ts";

const PAGE_DRIVER = `async function main() {
	await report("list0", await ask("window", "list"));
	await report("main0", await ask("window", "isOpen", { label: "main" }));
	await report("other0", await ask("window", "isOpen", { label: "other" }));
	await report("ghost", await ask("window", "isOpen", { label: "ghost" }));
	await report("title", await ask("window", "setTitle", { label: "main", title: APPLIED }));
	await report("titlebad", await ask("window", "setTitle", { label: "main", title: IMPOSSIBLE }));
	await report("focus1", await ask("window", "focus", { label: "main" }));
	await report("focus2", await ask("window", "focus", { label: "main" }));
	await report("focusother", await ask("window", "focus", { label: "other" }));
	await report("focusghost", await ask("window", "focus", { label: "ghost" }));
	await report("list1", await ask("window", "list"));
	await report("unknown", await ask("window", "doesNotExist", {}));
	await report("badlabel", await ask("window", "isOpen", { label: 42 }));
	await report("alive", await ask("window", "list"));

	// ---- a created window is a real second NSWindow ----------------------
	// Every create below runs while the pump is ticking: an invoke is delivered
	// by that pump, so an answer here has already crossed it. "child/relative"
	// has no leading slash on purpose — a relative url resolves against
	// /spare/idle.html, so it must land on /spare/child/relative; handed to
	// NSURL unchanged it becomes about:blank and runs no page at all.
	await report(
		"createrel",
		await ask("window", "create", {
			label: "relative",
			title: "Relative child",
			width: 460,
			height: 300,
			url: "child/relative",
		}),
	);
	// An absolute url is handed through as given: the same origin, a path no
	// resolver could have invented from this page's own location.
	await report(
		"createabs",
		await ask("window", "create", {
			label: "absolute",
			title: "Absolute child",
			width: 460,
			height: 300,
			url: location.origin + "/spare/child/absolute",
		}),
	);
	// Each child page reports on its own time; these two polls are the bound on
	// that, and a window that never loaded its document answers false here
	// rather than passing on the create's own ok.
	await report("sawrelative", { how: "resolved", value: await appeared("child.relative", 5000) });
	await report("sawabsolute", { how: "resolved", value: await appeared("child.absolute", 5000) });
	await report("lists2", await ask("window", "list"));
	await report("childopen", await ask("window", "isOpen", { label: "relative" }));
	await report(
		"childtitle",
		await ask("window", "setTitle", { label: "relative", title: "Relative titled" }),
	);
	await report("childclose", await ask("window", "close", { label: "relative" }));
	await report("childgone", await ask("window", "isOpen", { label: "relative" }));
	await report("absclose", await ask("window", "close", { label: "absolute" }));
	await report("absgone", await ask("window", "isOpen", { label: "absolute" }));
	await report("tidied", await ask("window", "list"));

	// A closed window, then the same label again: the release the adapter's
	// create depends on. Only the spare may be closed here — the driver's own
	// window is closed last, because after that this page is gone.
	await report("closemain", await ask("window", "close", { label: "main" }));
	await report("mainafter", await ask("window", "isOpen", { label: "main" }));
	await report("otherstill", await ask("window", "isOpen", { label: "other" }));
	await report("released", await released("main", 2000));
	await report(
		"recreate",
		await ask("window", "create", {
			label: "main",
			title: "Reopened main",
			width: 520,
			height: 300,
			url: "/spare/child/main",
		}),
	);
	// The re-created label loads its document again, and that page says so from
	// its own context: same label, a window that is open again, a fresh page.
	await report("sawreopen", { how: "resolved", value: await appeared("child.main", 5000) });
	await report("relist", await ask("window", "list"));
	await report("reopenopen", await ask("window", "isOpen", { label: "main" }));
	await report(
		"reopenset",
		await ask("window", "setTitle", { label: "main", title: "Reopened and titled" }),
	);

	// A live label is refused, and nothing is released to make room for it.
	await report("dup", await ask("window", "create", { label: "main", url: "/spare/idle.html" }));
	await report("duplist", await ask("window", "list"));
	await report("dupafter", await ask("window", "isOpen", { label: "main" }));

	// A label that never existed: created, found by every other command, closed.
	await report(
		"create",
		await ask("window", "create", {
			label: "spawn",
			title: "Spawned by the page",
			width: 500,
			height: 320,
			url: "/spare/idle.html",
		}),
	);
	await report("lists", await ask("window", "list"));
	await report("spawnopen", await ask("window", "isOpen", { label: "spawn" }));
	await report("spawnset", await ask("window", "setTitle", { label: "spawn", title: "Spawn titled" }));
	await report("spawnclose", await ask("window", "close", { label: "spawn" }));
	await report("spawngone", await ask("window", "isOpen", { label: "spawn" }));

	// Refused arguments, not clamped or coerced: no window is built for any of
	// them. A fractional size is the case a cast would silently round, so it gets
	// its own answer; the list afterwards proves no refusal left one behind.
	await report("badsize", await ask("window", "create", { label: "tiny", width: 0 }));
	await report("badfraction", await ask("window", "create", { label: "fraction", width: 12.5 }));
	await report("badurl", await ask("window", "create", { label: "nowhere", url: "" }));
	await report("reflist", await ask("window", "list"));

	await report("closeagain", await ask("window", "close", { label: "main" }));
	await report("maingone", await ask("window", "isOpen", { label: "main" }));
	await report("closing", { how: "resolved", value: "close other" });
	await ask("window", "close", { label: "other" });
}

// The driver is served at "/" and runs the whole sequence. A window created with
// a /child/<label> document runs this same script in *its own* page context and
// takes the probe branch instead — that is what makes "the child's own invoke
// answers" an observation rather than an assumption.
var CHILD = location.pathname.indexOf("/child/") !== -1;

(CHILD ? child() : main()).catch(function (error) {
	// A page that throws must not look like a quiet pass: one more line, and the
	// tag assertion fails with this reason beside it.
	report("crash", { how: "threw", message: String((error && error.message) || error) });
});
`;

/** The document `crust build` embeds, exactly as the single literal spelled it. */
export const PAGE_SOURCE = `${PAGE_PRELUDE}\n\n${PAGE_DRIVER}`;
