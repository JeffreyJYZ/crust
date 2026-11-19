/**
 * The `testing` namespace's test double: an adapter over the fake DOM in `testing-fake-dom.ts`.
 *
 * The snippets in `testing-script.ts` are evaluated here exactly as WebKit would evaluate them, so
 * the plugin's behaviour is provable with no window, no WebKit and no run loop. `trackFrameworkValue`
 * reproduces React's value tracker — an own `value` accessor that keeps its own copy — which is what
 * makes a plain assignment invisible to the framework and the prototype setter visible.
 */

import { PAGE_CONSOLE_SOURCE } from "../bridge/page-console.ts";
import type { TestingAdapter } from "./testing-types";
import { FakeDocument } from "./testing-fake-document.ts";
import { FakeElement, FakeEvent, FakeInput, FakeTextArea } from "./testing-fake-dom.ts";

export * from "./testing-fake-document.ts";
export * from "./testing-fake-dom.ts";

/** A console object the page tap can patch, with the calls it saw kept for the un-hooked case. */
export interface FakeConsole {
	calls: { level: string; args: unknown[] }[];
	log(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	debug(...args: unknown[]): void;
}

function fakeConsole(): FakeConsole {
	const calls: { level: string; args: unknown[] }[] = [];
	const record =
		(level: string) =>
		(...args: unknown[]): void => {
			calls.push({ level, args });
		};
	return {
		calls,
		log: record("log"),
		info: record("info"),
		warn: record("warn"),
		error: record("error"),
		debug: record("debug"),
	};
}

export interface FakePage {
	adapter: TestingAdapter;
	document: FakeDocument;
	window: Record<string, unknown>;
	console: FakeConsole;
}

/** Run the console tap against a fake page, the way a document-start user script would. */
export function installConsoleHook(page: FakePage): void {
	const run = new Function("window", "console", PAGE_CONSOLE_SOURCE);
	run(page.window, page.console);
}

/**
 * A fake platform over one page. Only the label it was built for exists, so a test can prove the
 * `unknown-window` refusal rather than assume it.
 */
export function fakeAdapter(document = new FakeDocument(), label = "main"): FakePage {
	const win: Record<string, unknown> = {};
	const log = fakeConsole();
	const adapter: TestingAdapter = {
		async evaluate(windowLabel: string | undefined, source: string): Promise<unknown> {
			if (windowLabel !== undefined && windowLabel !== label) {
				const error = new Error(`crust: no window labelled ${JSON.stringify(windowLabel)}`);
				(error as Error & { code?: string }).code = "unknown-window";
				throw error;
			}
			const run = new Function(
				"document",
				"window",
				"Event",
				"KeyboardEvent",
				"MouseEvent",
				"HTMLInputElement",
				"HTMLTextAreaElement",
				"getComputedStyle",
				"console",
				`return ${source};`,
			);
			return run(
				document,
				win,
				FakeEvent,
				FakeEvent,
				FakeEvent,
				FakeInput,
				FakeTextArea,
				(element: FakeElement) => ({
					display: element.style.display ?? "block",
					visibility: element.style.visibility ?? "visible",
					opacity: element.style.opacity ?? "1",
				}),
				log,
			);
		},
	};
	return { adapter, document, window: win, console: log };
}

/**
 * Give an input the value tracker React installs: an own `value` accessor that keeps the framework's
 * copy in step, plus the `input` listener that only fires when the copy and the field disagree.
 * `changes` collects the values the framework accepted, so a test can tell a real state update from
 * a field that merely holds text.
 */
export function trackFrameworkValue(element: FakeInput, changes: string[]): void {
	const proto = Object.getOwnPropertyDescriptor(FakeInput.prototype, "value");
	if (!proto?.get || !proto.set) throw new Error("FakeInput has no prototype value accessor");
	const read = proto.get as (this: FakeInput) => string;
	const write = proto.set as (this: FakeInput, next: string) => void;
	let tracked = read.call(element);
	Object.defineProperty(element, "value", {
		configurable: true,
		get(): string {
			return read.call(this);
		},
		set(next: string): void {
			tracked = String(next);
			write.call(this, next);
		},
	});
	element.addEventListener("input", () => {
		const value = read.call(element);
		if (value === tracked) return;
		tracked = value;
		changes.push(value);
	});
}
