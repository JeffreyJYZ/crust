/**
 * The scripts `crust:testing` runs in a window's own page, as source text.
 *
 * Each one is an expression `-evaluateJavaScript:completionHandler:` can evaluate, and each answers
 * a JSON *string*: WebKit hands the result back across `bun:ffi` as a string, and JSON is the one
 * shape that survives that boundary without an object graph. A page-side throw is caught here and
 * turned into the same typed failure the plugin answers, so a selector that never matched reads as
 * `not-found` rather than an opaque `NSError`.
 *
 * Nothing here posts an event outside the page: `click()` and `dispatchEvent` are ordinary DOM
 * calls, which is the whole point of driving the webview instead of the machine.
 */

import { CONSOLE_STORE } from "../bridge/page-console.ts";

/** The helpers every snippet shares; kept in one place so a fix lands in all of them. */
const PRELUDE = `
var fail = function (code, message) { throw { crustCode: code, message: message }; };
var elementFor = function (selector) {
	var element = document.querySelector(selector);
	if (!element) fail("not-found", "no element matches " + selector);
	return element;
};
var rectOf = function (element) {
	var rect = element.getBoundingClientRect();
	return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
};
var attributesOf = function (element) {
	var attributes = {};
	for (var index = 0; index < element.attributes.length; index++) {
		var item = element.attributes[index];
		attributes[item.name] = item.value;
	}
	return attributes;
};
var visible = function (element) {
	var rect = element.getBoundingClientRect();
	if (!(rect.width > 0 && rect.height > 0)) return false;
	var style = getComputedStyle(element);
	return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
};
`;

/** One snippet: the shared helpers, the body, and one catch that preserves the failure code. */
function wrap(body: string): string {
	return `(function () {
${PRELUDE}
try {
${body}
} catch (error) {
	return JSON.stringify({
		ok: false,
		code: (error && error.crustCode) || "handler-error",
		message: String((error && error.message) || error)
	});
}
})()`;
}

const json = (value: unknown): string => JSON.stringify(value);

/** `click`, `hover` and `query` share one shape: a selector and the window it points at. */
export interface SelectorScriptArgs {
	selector: string;
	label?: string;
}

export type TestingScriptName =
	"click" | "clickAt" | "type" | "key" | "hover" | "query" | "console";

/**
 * The body of one command. Split from `pageScript` so each rule sits beside the snippet that
 * enforces it — the native-setter rule in particular is one line away from its comment.
 */
function bodyOf(name: TestingScriptName, args: Record<string, unknown>): string {
	switch (name) {
		case "click": {
			const selector = json(args.selector);
			return `var element = elementFor(${selector});
var observed = false;
var watcher = function () { observed = true; };
if (typeof element.addEventListener === "function") element.addEventListener("click", watcher);
if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "center" });
if (typeof element.focus === "function") element.focus();
element.click();
if (typeof element.removeEventListener === "function") element.removeEventListener("click", watcher);
return JSON.stringify({ ok: true, clicked: observed, verified: observed });`;
		}
		case "clickAt": {
			const x = Number(args.x);
			const y = Number(args.y);
			return `var element = document.elementFromPoint(${x}, ${y});
if (!element) fail("not-found", "nothing is painted at ${x},${y}");
var observed = false;
var watcher = function () { observed = true; };
if (typeof element.addEventListener === "function") element.addEventListener("click", watcher);
if (typeof element.focus === "function") element.focus();
element.click();
if (typeof element.removeEventListener === "function") element.removeEventListener("click", watcher);
return JSON.stringify({ ok: true, clicked: observed, verified: observed });`;
		}
		case "type": {
			const selector = json(args.selector);
			const text = json(args.text);
			// Assigning `.value` directly does not notify React: its tracker holds its own copy of
			// the value and installs a `value` accessor on the element, so a plain assignment updates
			// the copy and the real field together and the framework then sees no change. Calling the
			// prototype's own setter goes under the tracker, so the tracker is stale, and the `input`
			// event that follows is honoured. Vue reads the event's target, so this works for both.
			return `var element = elementFor(${selector});
if (typeof element.value !== "string") fail("handler-error", ${selector} + " holds no value to type into");
if (typeof element.focus === "function") element.focus();
var proto = null;
if (typeof HTMLTextAreaElement === "function" && element instanceof HTMLTextAreaElement) proto = HTMLTextAreaElement.prototype;
else if (typeof HTMLInputElement === "function" && element instanceof HTMLInputElement) proto = HTMLInputElement.prototype;
var setter = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
if (setter && typeof setter.set === "function") setter.set.call(element, ${text});
else element.value = ${text};
element.dispatchEvent(new Event("input", { bubbles: true }));
return JSON.stringify({ ok: true, value: String(element.value) });`;
		}
		case "key": {
			const key = json(args.key);
			const modifiers = (args.modifiers ?? {}) as Record<string, unknown>;
			const alt = modifiers.alt === true;
			const ctrl = modifiers.ctrl === true;
			const meta = modifiers.meta === true;
			const shift = modifiers.shift === true;
			return `var init = {
	key: ${key},
	bubbles: true,
	cancelable: true,
	altKey: ${alt},
	ctrlKey: ${ctrl},
	metaKey: ${meta},
	shiftKey: ${shift}
};
var target = document.activeElement || document.body;
target.dispatchEvent(new KeyboardEvent("keydown", init));
target.dispatchEvent(new KeyboardEvent("keyup", init));
return JSON.stringify({
	ok: true,
	key: ${key},
	modifiers: { alt: ${alt}, ctrl: ${ctrl}, meta: ${meta}, shift: ${shift} },
	target: target.tagName || "?"
});`;
		}
		case "hover": {
			const selector = json(args.selector);
			return `var element = elementFor(${selector});
if (typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "center", inline: "center" });
var rect = element.getBoundingClientRect();
var init = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
element.dispatchEvent(new MouseEvent("mouseover", init));
element.dispatchEvent(new MouseEvent("mousemove", init));
return JSON.stringify({ ok: true, hovered: true });`;
		}
		case "query": {
			const selector = json(args.selector);
			return `var element = document.querySelector(${selector});
if (!element) {
	return JSON.stringify({
		ok: true,
		exists: false,
		visible: false,
		rect: { x: 0, y: 0, width: 0, height: 0 },
		text: "",
		value: null,
		attributes: {}
	});
}
var value = element.value;
return JSON.stringify({
	ok: true,
	exists: true,
	visible: visible(element),
	rect: rectOf(element),
	text: String(element.textContent || "").trim(),
	value: typeof value === "string" ? value : null,
	attributes: attributesOf(element)
});`;
		}
		case "console": {
			const since = typeof args.since === "number" ? args.since : 0;
			return `var entries = window.${CONSOLE_STORE};
if (!Array.isArray(entries)) return JSON.stringify({ ok: true, hooked: false, entries: [] });
var kept = [];
for (var index = 0; index < entries.length; index++) {
	if (!(entries[index].at < ${since})) kept.push(entries[index]);
}
return JSON.stringify({ ok: true, hooked: true, entries: kept });`;
		}
	}
}

/** The expression one command evaluates in the page. */
export function pageScript(name: TestingScriptName, args: Record<string, unknown>): string {
	return wrap(bodyOf(name, args));
}
