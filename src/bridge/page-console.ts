/**
 * The page-world console tap, as source text.
 *
 * It runs in the page's own world at document start, beside `window.crustInvoke` and for the same
 * reason: the page's `console` object lives in that world, so patching it from anywhere else
 * records nothing. It carries no token, opens no fetch and touches nothing the credential lives in,
 * so the bridge's isolation is unchanged — the tap only adds a `window.__crustConsole` array that
 * `testing.console` reads back through the same evaluation channel the other commands use.
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
	var text = function (value) {
		if (typeof value === "string") return value;
		try {
			var json = JSON.stringify(value);
			return json === undefined ? String(value) : json;
		} catch (error) {
			return String(value);
		}
	};
	var names = ["log", "info", "warn", "error", "debug"];
	for (var index = 0; index < names.length; index++) {
		(function (name) {
			var original = console[name];
			if (typeof original !== "function") return;
			console[name] = function () {
				var args = [];
				for (var slot = 0; slot < arguments.length; slot++) args.push(text(arguments[slot]));
				entries.push({ level: name, args: args, at: Date.now() });
				if (entries.length > limit) entries.splice(0, entries.length - limit);
				return original.apply(console, arguments);
			};
		})(names[index]);
	}
})();`;
