/**
 * What a page is told when its surface asks for a new webview. `target=_blank` and `window.open`
 * are refused by the platform's delegate, then re-checked here against the same origin allow list
 * every load passes: an allowed URL goes to the system opener, anything else is refused by name and
 * never reaches it. In neither case does a second webview exist.
 */
import type { BrowserAdapter } from "./browser-types";
import type { OriginPolicy } from "./browser-origin";
import type { PluginContext } from "./define";

export interface BrowserPopupEvent {
	label: string;
	url: string;
	handedToOpener: boolean;
	reason?: string;
}

/** The `onPopup` a surface carries: one closure per open, bound to that surface's label. */
export function popupReporter(
	label: string,
	ctx: PluginContext,
	adapter: BrowserAdapter,
	policy: OriginPolicy,
): (url: string) => void {
	return (url) => {
		const denial = policy.refusal(url, "popup");
		if (denial) {
			ctx.emit("browser:popup", {
				label,
				url,
				handedToOpener: false,
				reason: denial.message,
			} satisfies BrowserPopupEvent);
			return;
		}
		const outcome = adapter.external(url);
		ctx.emit("browser:popup", {
			label,
			url,
			handedToOpener: outcome.opened,
			...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
		} satisfies BrowserPopupEvent);
	};
}
