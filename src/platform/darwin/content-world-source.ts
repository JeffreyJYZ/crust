/**
 * The two scripts the content-world bridge is made of, as source text.
 *
 * They are strings rather than functions because both are injected as `WKUserScript` bodies, and a
 * function's own source would carry its module scope into a world that has none. They talk to each
 * other over DOM events carrying JSON *strings*, because the DOM is shared between worlds while the
 * JS object graph is not: a string is the one value that crosses safely.
 */

import { PAGE_CONSOLE_SOURCE } from "../../bridge/page-console.ts";

/**
 * Runs in the isolated world at document start.
 *
 * It reads the token out of `location.search` — the only place the bridge put it — keeps it in a
 * closure, and scrubs it from the shared URL before any page script runs, so page script that reads
 * `location.search` afterwards sees no credential. `history.replaceState` from this world rewrites
 * the one document both worlds navigate, which is why the page's own copy is clean too.
 *
 * The fetch is the page's existing wire call, unchanged in shape: same path, same body, same bearer
 * header. Nothing here reaches for a different protocol.
 */
export const CONTENT_WORLD_SOURCE = `(function () {
	var params = new URLSearchParams(location.search);
	var token = params.get("token") || "";
	if (token) {
		try {
			var clean = new URL(location.href);
			clean.searchParams.delete("token");
			history.replaceState(history.state, "", clean.pathname + clean.search + clean.hash);
		} catch (error) {}
	}
	var origin = location.origin;
	var label = (new URLSearchParams(location.search).get("window") || "").trim() || null;
	// The event stream needs the token too, and EventSource cannot set a header, so it is opened
	// here and its frames are relayed to the page as DOM events — the page never holds the bearer.
	var stream = null;
	var relaying = Object.create(null);
	var relay = function (name) {
		if (relaying[name] || !stream) return;
		relaying[name] = true;
		stream.addEventListener(name, function (message) {
			document.dispatchEvent(new CustomEvent("crust:evt", {
				detail: JSON.stringify({ event: name, data: message.data })
			}));
		});
	};
	var openStream = function () {
		if (stream) return;
		try {
			stream = new EventSource(origin + "/_crust/events?token=" + encodeURIComponent(token));
		} catch (error) { return; }
		stream.onerror = function () {};
	};
	document.addEventListener("crust:sub", function (event) {
		var asked;
		try { asked = JSON.parse(event.detail); } catch (error) { return; }
		openStream();
		if (!stream || !asked) return;
		var names = Array.isArray(asked) ? asked : Object.keys(asked);
		for (var index = 0; index < names.length; index++) {
			relay(String(names[index]));
		}
	});
	document.addEventListener("crust:req", function (event) {
		var request;
		try { request = JSON.parse(event.detail); } catch (error) { return; }
		var answer = function (payload) {
			document.dispatchEvent(new CustomEvent("crust:res", { detail: JSON.stringify(payload) }));
		};
		var send = function () {
			return fetch(origin + "/_crust/invoke", {
				method: "POST",
				headers: { authorization: "Bearer " + token, "content-type": "application/json" },
				body: JSON.stringify({
					plugin: request.plugin,
					command: request.command,
					args: request.args === undefined ? null : request.args,
					window: label
				})
			});
		};
		send().then(function (response) {
			return response.text().then(function (text) {
				try {
					var body = JSON.parse(text);
					if (body && body.ok === true) {
						answer({ id: request.id, ok: true, result: body.result });
					} else {
						var error = (body && body.error) || {};
						answer({
							id: request.id,
							ok: false,
							error: {
								code: typeof error.code === "string" ? error.code : "handler-error",
								message: typeof error.message === "string" ? error.message : "invoke failed",
								status: response.status,
								requires: typeof error.requires === "string" ? error.requires : undefined
							}
						});
					}
				} catch (parseError) {
					answer({
						id: request.id,
						ok: false,
						error: {
							code: "bad-response",
							message: "bridge returned non-json (" + response.status + ")",
							status: response.status
						}
					});
				}
			});
		}).catch(function () {
			answer({
				id: request.id,
				ok: false,
				error: { code: "no-fetch", message: "the bridge is unreachable", status: 0 }
			});
		});
	});
})();`;

/**
 * Runs in the page's own world at document start, before any page script.
 *
 * It defines exactly one function: `window.crustInvoke(plugin, command, args)`, resolving with the
 * `{ ok, result }` / `{ ok: false, error }` envelope. Page script can call every command the window
 * is granted; it cannot read the token, and replacing this function buys nothing, because the world
 * that owns the credential is not reached by the page.
 *
 * The console tap travels in the same script rather than a third `WKUserScript`: both halves are
 * page-world document-start work, and one script is what keeps a webview's controller holding the
 * count `content-world.ts` reads as its install state.
 */
const PAGE_INVOKE_SOURCE = `(function () {
	if (typeof window.crustInvoke === "function") return;
	var seq = 0;
	var waiting = Object.create(null);
	document.addEventListener("crust:res", function (event) {
		var reply;
		try { reply = JSON.parse(event.detail); } catch (error) { return; }
		var settle = waiting[reply.id];
		if (typeof settle !== "function") return;
		delete waiting[reply.id];
		settle(reply);
	});
	window.crustInvoke = function (plugin, command, args) {
		return new Promise(function (resolve) {
			var id = "crust-" + ++seq;
			waiting[id] = resolve;
			document.dispatchEvent(new CustomEvent("crust:req", {
				detail: JSON.stringify({
					id: id,
					plugin: plugin,
					command: command,
					args: args === undefined ? null : args
				})
			}));
		});
	};
})();`;

/**
 * The one page-world script: the console tap first, then the invoke bridge. Two IIFEs rather than
 * one, so the tap installs even when `crustInvoke` is already there — a page that reloaded into a
 * second document still gets its first console line recorded.
 */
export const PAGE_BRIDGE_SOURCE = `${PAGE_CONSOLE_SOURCE}\n${PAGE_INVOKE_SOURCE}`;
