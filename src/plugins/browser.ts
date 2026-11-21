/**
 * `crust:browser` — an embedded webview surface inside one of the app's windows.
 *
 * The surface is **not** the app's page and not the app's webview: it loads remote content from its
 * own `WKWebViewConfiguration`, so it carries no bridge token, no `window.crust`, and no grant
 * table of its own. Two gates therefore sit here, in the plugin, before any native call:
 * `http(s)` only, and only an origin `browser.origins` names. A URL refused by either never
 * becomes a load.
 *
 * `target=_blank` and `window.open` never become a second webview. The platform's new-window
 * delegate refuses the request and reports the URL here; the plugin re-checks the origin and hands
 * an allowed one to the system opener, so the app decides what a click means rather than WebKit.
 *
 * Nothing here throws: a bad argument or a refused send is a plain object the page can read.
 */
import type { BrowserConfig } from "@/config";
import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import { readBounds, readText } from "./browser-args";
import { originPolicy } from "./browser-origin";
import { popupReporter } from "./browser-popup";
import type {
	BrowserAdapter,
	BrowserBounds,
	BrowserCapture,
	BrowserFailure,
	BrowserOpenInput,
	BrowserState,
} from "./browser-types";

export type {
	BrowserAdapter,
	BrowserBounds,
	BrowserCapture,
	BrowserExternalOutcome,
	BrowserFailure,
	BrowserOpenInput,
	BrowserState,
} from "./browser-types";
export type { BrowserPopupEvent } from "./browser-popup";

type Opened = { ok: true; label: string } | BrowserFailure;
type Navigated = { ok: true; loaded: boolean } | BrowserFailure;
type Stated = (BrowserState & { ok: true }) | BrowserFailure;
type BoundsAnswer = { ok: true } | BrowserFailure;
type Closed = { ok: true; closed: true } | BrowserFailure;
type Captured = (BrowserCapture & { ok: true }) | BrowserFailure;

export function createBrowserPlugin(
	config?: BrowserConfig,
	adapter?: BrowserAdapter,
): PluginDefinition<
	"browser",
	{
		open: (args: unknown, ctx: PluginContext) => Opened | NotImplemented;
		navigate: (args: unknown, ctx: PluginContext) => Navigated | NotImplemented;
		state: (args: unknown, ctx: PluginContext) => Stated | NotImplemented;
		setBounds: (args: unknown, ctx: PluginContext) => BoundsAnswer | NotImplemented;
		close: (args: unknown, ctx: PluginContext) => Closed | NotImplemented;
		capture: (args: unknown, ctx: PluginContext) => Promise<Captured | NotImplemented>;
	}
> {
	const policy = originPolicy(config);
	const missing = (command: string): NotImplemented =>
		notImplemented(
			`browser.${command} needs an embedded webview surface, which this platform does not ` +
				"provide; macOS is the only platform crust builds it on today",
			"WKWebView",
		);

	/** Every adapter call funnels through this, so a throw is a value rather than a rejection. */
	const guard = <Result>(call: () => Result): Result | BrowserFailure => {
		try {
			return call();
		} catch (error) {
			return {
				ok: false,
				code: "handler-error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	};

	/** An unknown surface is `not-found`, not a silent no-op. */
	const absent = (label: string, command: string): BrowserFailure => ({
		ok: false,
		code: "not-found",
		message: `browser.${command}: no surface called ${JSON.stringify(label)} is open`,
	});

	return definePlugin({
		name: "browser",
		commands: {
			/** Create one surface in the caller's window. `browser:open` is its own capability action. */
			open: (args: unknown, ctx: PluginContext): Opened | NotImplemented => {
				if (!adapter) return missing("open");
				const label = readText(args, "label", "open");
				if (typeof label !== "string") return label;
				const url = readText(args, "url", "open");
				if (typeof url !== "string") return url;
				const refused = policy.refusal(url, "open");
				if (refused) return refused;
				const bounds = readBounds(args, "open");
				if ("ok" in bounds) return bounds;

				const onPopup = popupReporter(label, ctx, adapter, policy);

				const input: BrowserOpenInput = {
					label,
					url,
					bounds,
					...(ctx.window === undefined ? {} : { owner: ctx.window }),
					onPopup,
				};
				return guard(() => adapter.open(input));
			},
			/** Point one surface at another allowlisted origin, in place. */
			navigate: (args: unknown, _ctx: PluginContext): Navigated | NotImplemented => {
				const label = readText(args, "label", "navigate");
				if (typeof label !== "string") return label;
				const url = readText(args, "url", "navigate");
				if (typeof url !== "string") return url;
				const refused = policy.refusal(url, "navigate");
				if (refused) return refused;
				if (!adapter) return missing("navigate");
				return guard(() => adapter.navigate(label, url));
			},
			/** The address, title and history flags at this moment. */
			state: (args: unknown): Stated | NotImplemented => {
				const label = readText(args, "label", "state");
				if (typeof label !== "string") return label;
				if (!adapter) return missing("state");
				const answer = guard(() => adapter.state(label));
				return answer === null ? absent(label, "state") : answer;
			},
			/** Move and resize the rectangle the app reserves; the app owns re-applying it on resize. */
			setBounds: (args: unknown): BoundsAnswer | NotImplemented => {
				const label = readText(args, "label", "setBounds");
				if (typeof label !== "string") return label;
				const bounds = readBounds(args, "setBounds");
				if ("ok" in bounds) return bounds;
				if (!adapter) return missing("setBounds");
				return guard(() => adapter.setBounds(label, bounds));
			},
			/** Tear the surface down; the app's own window stays. */
			close: (args: unknown): Closed | NotImplemented => {
				const label = readText(args, "label", "close");
				if (typeof label !== "string") return label;
				if (!adapter) return missing("close");
				return guard(() => adapter.close(label));
			},
			/**
			 * The surface's own render. `window.capture` snapshots the app's WKWebView and cannot see
			 * a native sibling, so this is the picture of what was embedded — and its width/height are
			 * what `setBounds` changed.
			 */
			capture: async (args: unknown): Promise<Captured | NotImplemented> => {
				const label = readText(args, "label", "capture");
				if (typeof label !== "string") return label;
				if (!adapter) return missing("capture");
				try {
					return await adapter.capture(label);
				} catch (error) {
					return {
						ok: false,
						code: "handler-error",
						message: error instanceof Error ? error.message : String(error),
					};
				}
			},
		},
	});
}
