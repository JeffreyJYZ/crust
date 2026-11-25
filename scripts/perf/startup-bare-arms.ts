/** The AppKit floor probe's page and cumulative arms, kept apart from the driver. */

export const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>crust bare probe</title></head>
<body><script>requestAnimationFrame(function(){document.title="DONE";});</script></body></html>`;

/** Diagnostic: title set synchronously proves the document loaded without rAF. */
export const PAGE_SYNC = `<!doctype html><html><head><meta charset="utf-8"><title>crust bare probe</title></head>
<body><script>document.title="DONE";</script></body></html>`;

export interface Arm {
	flags: number;
	bridge: boolean;
	load: "html" | "url";
	/** Start the bridge only after first paint: the regression demonstration. */
	after?: boolean;
	/** Start it after window creation but before the document request. */
	deferBeforeLoad?: boolean;
}

/**
 * Flags are cumulative: 1 fresh pool, 2 content-world scripts, 4 config flag,
 * 8 crust-net scheme handler, 16 crust's regular activation policy. The floor
 * is bare-inline; every later arm is a delta over it.
 */
export const ARMS: Record<string, Arm> = {
	"bare-sync": { flags: 0, bridge: false, load: "html" },
	"bare-inline": { flags: 0, bridge: false, load: "html" },
	"bare-activation": { flags: 16, bridge: false, load: "html" },
	// Crust's WKWebViewConfiguration has no flags beyond stock; control row.
	"bare-config": { flags: 16, bridge: false, load: "html" },
	"bare-scripts": { flags: 18, bridge: false, load: "html" },
	"bare-scheme": { flags: 26, bridge: false, load: "html" },
	"bare-pool": { flags: 27, bridge: false, load: "html" },
	"bare-bridge": { flags: 0, bridge: true, load: "html" },
	"bare-http": { flags: 8, bridge: true, load: "url" },
	/** Same flags and bridge as bare-http, inline document: isolates navigation. */
	"bare-http-control": { flags: 8, bridge: true, load: "html" },
	"bare-no-bridge": { flags: 0, bridge: false, load: "url" },
	"bare-deferred": { flags: 0, bridge: false, load: "html", after: true },
	"bare-deferred-load": { flags: 0, bridge: false, load: "html", deferBeforeLoad: true },
};
