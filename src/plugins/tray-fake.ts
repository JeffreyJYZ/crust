/**
 * The tray plugin's test double, shared by the `tray*.test.ts` suites.
 *
 * Imported only by tests: product code never reads it, and `tray.ts` has no
 * knowledge of it.
 */

import type { PluginContext } from "@/plugins/define";
import type { TrayMenuItem, TrayNative } from "@/plugins/tray";

export interface FakeTray extends TrayNative {
	calls: string[];
	items: readonly TrayMenuItem[];
}

export function fakeAdapter(): FakeTray {
	const adapter: FakeTray = {
		calls: [],
		items: [],
		setTitle(text) {
			adapter.calls.push(`setTitle:${text}`);
		},
		setMenu(items) {
			adapter.calls.push(`setMenu:${items.map((item) => item.label).join(",")}`);
			adapter.items = items;
		},
		show() {
			adapter.calls.push("show");
		},
		hide() {
			adapter.calls.push("hide");
		},
		destroy() {
			adapter.calls.push("destroy");
		},
	};
	return adapter;
}

export function recordingContext(): { ctx: PluginContext; events: Array<[string, unknown]> } {
	const events: Array<[string, unknown]> = [];
	return {
		events,
		ctx: { emit: (event, data) => events.push([event, data]) },
	};
}
