/**
 * The window plugin's test double, shared by the `window.*.test.ts` suites.
 *
 * Imported only by tests: product code never reads it, and `window.ts` has no
 * knowledge of it. It lives apart so a 600-line suite could become four without
 * each copy drifting.
 */

import { type WindowNative, WindowAdapterError } from "./window-types.ts";

export const ctx = { emit: () => {} };

export interface FakeWindow {
	open: boolean;
	title?: string;
}

/**
 * A fake platform: labels are tracked the way `DarwinPlatform` tracks them, so
 * a closed window stays listed (its number is 0) instead of vanishing.
 *
 * `create` records the exact options it was handed, so a test can assert what
 * crossed the seam rather than only what the plugin answered — a create that
 * clamped a size or dropped a title would otherwise look identical.
 */
export function fakeAdapter(labels: string[] = ["main"]): WindowNative & {
	calls: string[];
	windows: Map<string, FakeWindow>;
} {
	const windows = new Map<string, FakeWindow>(
		labels.map((label) => [label, { open: true } as FakeWindow]),
	);
	const calls: string[] = [];
	const require = (label: string): FakeWindow => {
		const entry = windows.get(label);
		if (!entry) {
			throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
		}
		return entry;
	};
	return {
		calls,
		windows,
		create: (options) => {
			calls.push(
				`create:${options.label}:${options.width ?? "-"}x${options.height ?? "-"}:` +
					`${options.title ?? "-"}:${options.url ?? "-"}`,
			);
			// `DarwinPlatform.createWindow` refuses a label still in its map, even
			// when the window was closed; only the platform can see that.
			if (windows.has(options.label)) {
				throw new WindowAdapterError(
					"duplicate-label",
					`crust: a window labelled ${JSON.stringify(options.label)} already exists`,
				);
			}
			windows.set(options.label, { open: true, title: options.title });
			return { label: options.label };
		},
		close: (label) => {
			calls.push(`close:${label}`);
			require(label).open = false;
		},
		focus: (label) => {
			calls.push(`focus:${label}`);
			require(label);
		},
		setTitle: (label, title) => {
			calls.push(`setTitle:${label}:${title}`);
			require(label).title = title;
		},
		list: () => [...windows.keys()],
		isOpen: (label) => require(label).open,
	};
}
