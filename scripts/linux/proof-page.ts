/**
 * The page the webview loads, and the bridge that serves it: the app's own `startBridge`, started
 * in-process, so the document arrives with the same bootstrap an app gets and `window.crust.invoke`
 * is the real client rather than a stub. One plugin command answers, because an invoke needs
 * something to carry back.
 */
import { type BridgeHandle, startBridge } from "../../src/bridge/server.ts";
import { definePlugin } from "../../src/plugins/define.ts";

/**
 * The document's own title. It deliberately differs from the window's, so a title read back off the
 * view proves a document parsed rather than echoing the string the window was created with.
 */
export const DOCUMENT_TITLE = "crust smoke document";

/** The page: a title and one marker. The client is injected by the bridge, never written here. */
export const PAGE_HTML = [
	"<!doctype html>",
	'<html lang="en"><head><meta charset="utf-8">',
	`<title>${DOCUMENT_TITLE}</title></head>`,
	'<body><p id="marker">crust smoke</p></body></html>',
].join("\n");

/**
 * The same document as a `data:` URL, for a run where the bridge cannot start. A document still
 * loads and its scripts still run; invoke is what stays unproved, and says so.
 */
export const DATA_PAGE_URL = `data:text/html,${encodeURIComponent(
	`<title>${DOCUMENT_TITLE}</title><p>crust smoke</p>`,
)}`;

/** What the one handler answers, so the page has a value it can echo back. */
export const ECHOED = { n: 41, from: "smoke" };

/** The handler the page may call: `smoke.echo`. */
export const SMOKE_PLUGIN = definePlugin({
	name: "smoke",
	commands: { echo: () => ({ echoed: ECHOED }) },
});

/** What the page holds while the call is still in flight, so a poll can tell the two apart. */
export const INVOKE_PENDING = "pending";

/**
 * The script that crosses the bridge. It stores the answer on `window`, because
 * `evaluate_javascript` answers once per call and a promise would only stringify to
 * `[object Promise]`.
 */
export function invokeScript(): string {
	return [
		'window.__crustSmoke = "pending";',
		'window.crust.invoke("smoke", "echo", { n: 41 }).then(',
		'function (v) { window.__crustSmoke = "ok " + JSON.stringify(v); },',
		'function (e) { window.__crustSmoke = "err " + (e && e.message ? e.message : String(e)); });',
	].join("\n");
}

export interface ProofPage {
	/** The bridge's own origin, which is the URL the window loads. */
	url: string;
	/** Release the port and every open event stream. */
	stop(): Promise<void>;
}

/** Start the bridge with the smoke page; throws when the port cannot be bound. */
export function startProofPage(): ProofPage {
	const bridge: BridgeHandle = startBridge({ handlers: [SMOKE_PLUGIN], indexHtml: PAGE_HTML });
	return { url: bridge.url, stop: () => bridge.stop() };
}
