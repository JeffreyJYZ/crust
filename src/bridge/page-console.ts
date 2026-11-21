/**
 * The page-world console and uncaught-error tap, as source text.
 *
 * It runs in the page's own world at document start, beside `window.crustInvoke` and for the same
 * reason: the page's `console` object lives in that world, so patching it from anywhere else
 * records nothing. It carries no credential, opens no request and touches nothing the credential
 * lives in, so the bridge's isolation is unchanged — it only adds a `window.__crustConsole` array
 * that `testing.console` reads back, and dispatches one `crust:log` DOM event per entry. The
 * content-world script, which owns the credential, relays that event to `POST /_crust/log`.
 *
 * Entries are bounded and values are stringified, because this runs in a page the app does not
 * control and an unbounded log of live objects would both leak memory and be unreadable over JSON.
 */

/** Where the tap keeps its entries; `testing.console` evaluates this name. */
export const CONSOLE_STORE = "__crustConsole";

/** How many entries the tap keeps, oldest dropped first. */
export const CONSOLE_LIMIT = 500;

export const PAGE_CONSOLE_SOURCE = `(function () {
	var store = window.${CONSOLE_STORE};
	if (Array.isArray(store)) return;
	var entries = [];
	window.${CONSOLE_STORE} = entries;
	var limit = ${CONSOLE_LIMIT};
	var here = function () {
		try { return location.href; } catch (error) { return undefined; }
	};
	var send = function (payload) {
		try {
			if (typeof document === "undefined" || typeof document.dispatchEvent !== "function") return;
			if (typeof CustomEvent !== "function") return;
			payload.url = payload.url || here();
			document.dispatchEvent(new CustomEvent("crust:log", { detail: JSON.stringify(payload) }));
		} catch (error) {}
	};
	var typeName = function (value) {
		if (value === null) return "null";
		if (Array.isArray(value)) return "array";
		return typeof value;
	};
	var text = function (value) {
		if (typeof value === "string") return value;
		var json;
		try {
			json = JSON.stringify(value);
		} catch (error) {}
		if (json !== undefined) return json;
		try {
			return String(value);
		} catch (error) {
			return "[unprintable " + typeName(value) + "]";
		}
	};
	var names = ["log", "info", "warn", "error", "debug"];
	for (var index = 0; index < names.length; index++) {
		(function (name) {
			var original = console[name];
			if (typeof original !== "function") return;
			console[name] = function () {
				var entry = { level: name, args: [], at: Date.now() };
				entries.push(entry);
				if (entries.length > limit) entries.splice(0, entries.length - limit);
				for (var slot = 0; slot < arguments.length; slot++) entry.args.push(text(arguments[slot]));
				send({ kind: "console", level: name, args: entry.args.slice(0, 50) });
				return original.apply(console, arguments);
			};
		})(names[index]);
	}
	if (typeof window.addEventListener === "function") {
		window.addEventListener("error", function (event) {
			var error = event && event.error;
			send({
				kind: "error",
				message: event && event.message ? String(event.message) : "uncaught error",
				stack: error && error.stack ? String(error.stack) : undefined,
				url: event && event.filename ? String(event.filename) : undefined,
				line: event && typeof event.lineno === "number" ? event.lineno : undefined,
				col: event && typeof event.colno === "number" ? event.colno : undefined
			});
		});
		window.addEventListener("unhandledrejection", function (event) {
			var reason = event && event.reason;
			send({
				kind: "rejection",
				message: reason && reason.message ? String(reason.message) : String(reason),
				stack: reason && reason.stack ? String(reason.stack) : undefined
			});
		});
	}
})();`;
