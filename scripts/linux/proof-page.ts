/**
 * The page the webview loads, and the bridge that serves it: the app's own `startBridge`, started
 * in-process, so the document arrives with the same bootstrap an app gets and `window.crust.invoke`
 * is the real client rather than a stub. One plugin command answers an invoke, and one pushes events,
 * because the two halves of the bridge are proven separately.
 */
import { type BridgeHandle, startBridge } from "../../src/bridge/server.ts";
import type { PluginContext } from "../../src/plugins/define.ts";
import { definePlugin } from "../../src/plugins/define.ts";

/**
 * The document's own title. It deliberately differs from the window's, so a title read back off the
 * view proves a document parsed rather than echoing the string the window was created with.
 */
export const DOCUMENT_TITLE = "crust smoke document";

/** The event names the page subscribes to, and the payloads the host pushes back. */
export const TICK_EVENT = "tick";
export const HELLO_EVENT = "hello";
export const TICK = { tick: 1 };
export const HELLO = { hello: "world" };

/** What the page holds while an event is still on its way, so a poll can tell the two apart. */
export const EVENTS_PENDING = "pending";

/**
 * The subscription half, written into the document itself so it runs while the parser is still in
 * the task that installed the client. That ordering is what lets a page listener see `crust:ready`:
 * the stream pushes that frame exactly once, on connect, and a listener registered after the parser
 * has yielded to the event loop would miss it. Every answer is a JSON string on `window`, because
 * `evaluate_javascript` answers text and a promise would only stringify to `[object Promise]`.
 *
 * The broadcast is gated on `crust.ready`, which resolves on the first frame: an invoke that beat
 * the stream's own subscriber would emit into an empty set and prove nothing.
 *
 * The last request asks the stream's own URL with `fetch`, so a refusal is quoted in the bridge's
 * words instead of being inferred from a stream that never opened. It is the same GET the client
 * makes, which is why a `403` here names the cause rather than leaving a `pending` to guess at.
 */
export const EVENTS_SCRIPT = [
	'window.__crustEvents = { listen: "pending", once: "pending", ready: "pending", frame: "", stream: "", error: "" };',
	'window.crust.listen("crust:ready", function (p) { window.__crustEvents.frame = JSON.stringify(p); });',
	'window.crust.listen("tick", function (p) { window.__crustEvents.listen = JSON.stringify(p); });',
	'window.crust.once("hello").then(function (p) { window.__crustEvents.once = JSON.stringify(p); });',
	"window.crust.ready.then(function () {",
	'  window.__crustEvents.ready = "resolved";',
	'  fetch(window.crust.baseUrl + "/_crust/events?token=" + encodeURIComponent(window.crust.token)).then(',
	"    function (r) {",
	'      if (r.status !== 200) return r.text().then(function (t) { window.__crustEvents.stream = r.status + " " + t.slice(0, 160); });',
	'      window.__crustEvents.stream = "200 open";',
	"      if (r.body) r.body.cancel();",
	"    },",
	'    function (e) { window.__crustEvents.stream = "err " + (e && e.message ? e.message : String(e)); });',
	'  window.crust.invoke("smoke", "broadcast").then(function () {},',
	"    function (e) { window.__crustEvents.error = e && e.message ? e.message : String(e); });",
	"});",
].join("\n");

/** The page: a title, one marker, and the subscriptions. The client is injected by the bridge. */
export const PAGE_HTML = [
	"<!doctype html>",
	'<html lang="en"><head><meta charset="utf-8">',
	`<title>${DOCUMENT_TITLE}</title></head>`,
	`<body><p id="marker">crust smoke</p><script>${EVENTS_SCRIPT}</script></body></html>`,
].join("\n");

/**
 * The same document as a `data:` URL, for a run where the bridge cannot start. A document still
 * loads and its scripts still run; invoke and the event stream are what stay unproved, and say so.
 */
export const DATA_PAGE_URL = `data:text/html,${encodeURIComponent(
	`<title>${DOCUMENT_TITLE}</title><p>crust smoke</p>`,
)}`;

/** What the one handler answers, so the page has a value it can echo back. */
export const ECHOED = { n: 41, from: "smoke" };

/** The handler the page may call: `smoke.echo`, and the one that pushes events: `smoke.broadcast`. */
export const SMOKE_PLUGIN = definePlugin({
	name: "smoke",
	commands: {
		echo: () => ({ echoed: ECHOED }),
		// The host half of the event proof. `ctx` is the one `startBridge` builds for every command,
		// so a frame emitted here travels the app's own path to the stream rather than one the
		// harness opened beside it.
		broadcast: (_args: unknown, ctx: PluginContext) => {
			ctx.emit(HELLO_EVENT, HELLO);
			ctx.emit(TICK_EVENT, TICK);
			return { sent: 2 };
		},
	},
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

/** The page's own record of the stream: one JSON string per event, plus the ready frame. */
export interface HeldEvents {
	listen: string;
	once: string;
	ready: string;
	frame: string;
	/** The stream's own HTTP answer, so a refusal is quoted rather than inferred. */
	stream?: string;
	error?: string;
}

export interface ProofPage {
	/** The bridge's own origin, which is the URL the window loads. */
	url: string;
	/** The bound port, so the ready frame's payload can be checked against it. */
	port: number;
	/** Release the port and every open event stream. */
	stop(): Promise<void>;
}

/** Start the bridge with the smoke page; throws when the port cannot be bound. */
export function startProofPage(): ProofPage {
	const bridge: BridgeHandle = startBridge({
		handlers: [SMOKE_PLUGIN],
		indexHtml: PAGE_HTML,
	});
	return { url: bridge.url, port: bridge.port, stop: () => bridge.stop() };
}
