/**
 * The window plugin's test double, shared by the `window.*.test.ts` suites and imported only by tests. `window.ts` has no knowledge of it; it lives apart so a 600-line suite could become four without the copies drifting.
 */

import { type WindowNative, WindowAdapterError } from "./window-types.ts";

export const ctx = { emit: () => {} };

/** One tracked window: what `list` knows, plus the state a command changed. */
export interface FakeWindow {
	open: boolean;
	title?: string;
	/** The frame `getSize` and `getPosition` read, and `setSize`/`setPosition` write. */
	frame: { x: number; y: number; width: number; height: number };
	alwaysOnTop: boolean;
	fullscreen: boolean;
	minimized: boolean;
	maximized: boolean;
}

/** A fresh window: 800×600 at the origin, every flag off. */
function blank(title?: string): FakeWindow {
	return {
		open: true,
		title,
		frame: { x: 0, y: 0, width: 800, height: 600 },
		alwaysOnTop: false,
		fullscreen: false,
		minimized: false,
		maximized: false,
	};
}

/**
 * A fake platform: labels are tracked the way `DarwinPlatform` tracks them, so a closed window stays listed with number 0 rather than vanishing. `create` records the exact options handed to it, so a test can assert what crossed the seam — a create that clamped a size or dropped a title would otherwise look identical. The state commands record their arguments the same way, so a plugin that rounded a size or flipped a flag is visible in `calls`.
 */
export function fakeAdapter(labels: string[] = ["main"]): WindowNative & {
	calls: string[];
	windows: Map<string, FakeWindow>;
} {
	const windows = new Map<string, FakeWindow>(labels.map((label) => [label, blank()]));
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
			windows.set(options.label, blank(options.title));
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
		setSize: (label, size) => {
			calls.push(`setSize:${label}:${size.width}x${size.height}`);
			const entry = require(label);
			entry.frame.width = size.width;
			entry.frame.height = size.height;
		},
		getSize: (label) => {
			const { width, height } = require(label).frame;
			return { width, height };
		},
		setPosition: (label, point) => {
			calls.push(`setPosition:${label}:${point.x},${point.y}`);
			const entry = require(label);
			entry.frame.x = point.x;
			entry.frame.y = point.y;
		},
		getPosition: (label) => {
			const { x, y } = require(label).frame;
			return { x, y };
		},
		setAlwaysOnTop: (label, value) => {
			calls.push(`setAlwaysOnTop:${label}:${value}`);
			require(label).alwaysOnTop = value;
		},
		isAlwaysOnTop: (label) => require(label).alwaysOnTop,
		setFullscreen: (label, value) => {
			calls.push(`setFullscreen:${label}:${value}`);
			require(label).fullscreen = value;
		},
		isFullscreen: (label) => require(label).fullscreen,
		minimize: (label) => {
			calls.push(`minimize:${label}`);
			require(label).minimized = true;
		},
		unminimize: (label) => {
			calls.push(`unminimize:${label}`);
			require(label).minimized = false;
		},
		isMinimized: (label) => require(label).minimized,
		maximize: (label) => {
			calls.push(`maximize:${label}`);
			require(label).maximized = true;
		},
		isMaximized: (label) => require(label).maximized,
	};
}
