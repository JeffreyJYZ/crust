/**
 * `window-state`'s test double: real frames in a map, so a restore is checked by reading them back, plus the calls a write made. Shared by the single-window suite and the every-window one so two copies cannot drift. A `broken` label throws from its frame reads, which is the platform state a skipped window has to survive.
 */

import { WindowAdapterError } from "./window-types.ts";

export interface FakeFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A fake platform holding real frames; `broken` labels answer no frame at all. */
export function fakeWindow(frames: Record<string, FakeFrame>, broken: readonly string[] = []) {
	const windows = new Map<string, FakeFrame>(
		Object.entries(frames).map(([l, f]) => [l, { ...f }]),
	);
	const calls: string[] = [];
	const at = (label: string): FakeFrame => {
		if (broken.includes(label)) {
			throw new WindowAdapterError("handler-error", `window ${label} answered no frame`);
		}
		const frame = windows.get(label);
		if (!frame) throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
		return frame;
	};
	return {
		calls,
		windows,
		list: () => [...windows.keys()],
		getSize: (label: string) => ({ width: at(label).width, height: at(label).height }),
		getPosition: (label: string) => ({ x: at(label).x, y: at(label).y }),
		setSize: (label: string, size: { width: number; height: number }) => {
			calls.push(`setSize:${label}:${size.width}x${size.height}`);
			Object.assign(at(label), size);
		},
		setPosition: (label: string, position: { x: number; y: number }) => {
			calls.push(`setPosition:${label}:${position.x},${position.y}`);
			Object.assign(at(label), position);
		},
	};
}
