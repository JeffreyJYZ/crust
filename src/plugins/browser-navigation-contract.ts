/**
 * The adapter-facing half of the `onNavigate` contract. The plugin can build the decision and the
 * fake can prove a redirect chain, but neither says whether a real adapter consults the callback —
 * that is the part that was missing and left `browser.origins` gating entry only.
 *
 * `assertNavigationDecision` drives any `BrowserAdapter` through `open` and then asks it to commit
 * a foreign URL the way a redirect would. A stub that ignores `onNavigate` commits the URL and the
 * assertion throws; a conforming adapter (WKNavigationDelegate `decidePolicyForNavigationAction`,
 * WebView2 `NavigationStarting`, WebKitGTK `decide-policy`) cancels it and keeps the last good URL.
 * Native lanes can call this from their own adapter suites without depending on this repo's fakes.
 */
import { createBrowserPlugin } from "./browser";
import type { BrowserAdapter, BrowserBounds, BrowserFailure } from "./browser-types";
import type { NotImplemented } from "./define";

const LABEL = "contract-surface";
const TRUSTED = "https://trusted.example";
const FOREIGN = "http://169.254.169.254/latest/meta-data/";
const BOUNDS: BrowserBounds = { x: 0, y: 0, width: 320, height: 200 };

/** What an adapter's `open` must have received, and what a commit must have done with it. */
export interface ContractFailure {
	ok: false;
	code: "contract-violation";
	message: string;
}

function violation(message: string): ContractFailure {
	return { ok: false, code: "contract-violation", message };
}

/**
 * Check one adapter against the committed-navigation contract. Returns `ok: true` on a conforming
 * adapter and a typed violation otherwise, so a native suite can assert either shape without the
 * plugin's own origin policy hiding the gap.
 */
export function checkNavigationDecision(
	adapter: BrowserAdapter,
): { ok: true; label: string } | ContractFailure {
	let captured: Parameters<BrowserAdapter["open"]>[0] | undefined;
	// A Proxy keeps the adapter's own `this` for methods that need it, and only observes `open`.
	const observed: BrowserAdapter = new Proxy(adapter, {
		get(target, key, receiver) {
			const value = Reflect.get(target, key, receiver);
			if (key !== "open" || typeof value !== "function") return value;
			return (input: Parameters<BrowserAdapter["open"]>[0]) => {
				captured = input;
				return (value as BrowserAdapter["open"]).call(target, input);
			};
		},
	});

	const plugin = createBrowserPlugin({ origins: [TRUSTED] }, observed);
	const opened: { ok: true; label: string } | BrowserFailure | NotImplemented =
		plugin.commands.open(
			{ label: LABEL, url: `${TRUSTED}/`, bounds: BOUNDS },
			{ emit: () => {} },
		);
	if (!opened.ok)
		return violation(
			`open was refused before the contract could be checked: ${opened.message}`,
		);
	if (typeof captured?.onNavigate !== "function") {
		return violation(
			"open did not receive an onNavigate decision; the adapter cannot gate commits",
		);
	}
	if (captured.onNavigate(`${TRUSTED}/next`) !== true) {
		return violation("the decision refused a same-origin navigation it should have allowed");
	}
	if (captured.onNavigate(FOREIGN) !== false) {
		return violation("the decision allowed a foreign origin it should have refused");
	}

	const before = adapter.state(LABEL);
	if (!before || !("ok" in before) || !before.ok) {
		return violation(
			"the adapter exposes no state for the surface, so a commit cannot be observed",
		);
	}
	try {
		adapter.navigate(LABEL, FOREIGN);
	} catch (error) {
		return violation(
			`committing a foreign URL threw instead of being refused: ${String(error)}`,
		);
	}
	const after = adapter.state(LABEL);
	if (after && "ok" in after && after.ok && after.url === FOREIGN) {
		return violation(
			"the adapter ignored onNavigate: a foreign URL committed after open (this is the live HIGH finding)",
		);
	}
	return { ok: true, label: LABEL };
}

/** The throwing form for suites that want a failure to read as a test failure, not an assertion. */
export function assertNavigationDecision(adapter: BrowserAdapter): void {
	const answer = checkNavigationDecision(adapter);
	if (!answer.ok) throw new Error(`browser.onNavigate contract: ${answer.message}`);
}
