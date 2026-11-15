/**
 * macOS global shortcuts: the accelerator grammar lives in `plugins/shortcuts.ts`; this file is the OS half, a `RegisterEventHotKey` unit compiled at launch from `shim/93_shortcuts.c` the way the tray compiles its own (`cc()`, no artifact, no Xcode, Carbon linked by name).
 * The press reaches JavaScript the way a tray click does: the C event handler calls the `JSCallback` this module installs once, and the id it carries is mapped back to a canonical accelerator here, so no Carbon object is ever held on the JS side.
 * `dispatch` is the test seam: it builds the event a press would have carried and sends it to the application event target, so the installed handler runs for real with no key, no HID post and no accessibility grant.
 */

import { cc, FFIType, JSCallback } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedAccelerator, ShortcutAdapter, ShortcutResult } from "@/plugins/shortcuts";
import source from "./shim/93_shortcuts.c" with { type: "text" };
import { KEYCODES, MODIFIER_BITS } from "./shortcut-keycodes";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** The exports, as `bun:ffi` hands them back. Ids are the C unit's, never pointers. */
export interface ShortcutUnit {
	symbols: {
		shortcut_abi: () => number;
		shortcut_install: (imp: number) => number;
		shortcut_register: (keycode: number, modifiers: number) => number;
		shortcut_unregister: (id: number) => number;
		shortcut_unregister_all: () => number;
		/** Fire a registered id as a press would; 1 only for an id this unit holds. */
		shortcut_dispatch: (id: number) => number;
		/** Bitmask of the Carbon calls that resolved on the dispatch path, 31 for all. */
		shortcut_event_abi: () => number;
	};
}

function compile(): ShortcutUnit {
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-shortcuts-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, source);
	return cc({
		source: path,
		flags: ["-framework", "Carbon", "-framework", "Foundation"],
		symbols: {
			shortcut_abi: { args: [], returns: I32 },
			shortcut_install: { args: [P], returns: I32 },
			shortcut_register: { args: [I32, I32], returns: I32 },
			shortcut_unregister: { args: [I32], returns: I32 },
			shortcut_unregister_all: { args: [], returns: I32 },
			shortcut_dispatch: { args: [I32], returns: I32 },
			shortcut_event_abi: { args: [], returns: I32 },
		},
	}) as unknown as ShortcutUnit;
}

let unitOnce: ShortcutUnit | undefined;

/** Compile at most once per process. */
export function shortcutUnit(): ShortcutUnit {
	return (unitOnce ??= compile());
}

/** Compile-and-link proof for the suite. Registers nothing, so no hot key exists. */
export function shortcutUnitStatus(): { available: boolean; reason: string } {
	try {
		const native = shortcutUnit();
		return native.symbols.shortcut_abi() === 1
			? { available: true, reason: "compiled" }
			: { available: false, reason: "shortcut_abi answered something other than 1" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}

/** Canonical accelerator → the C unit's id, and the reverse for the press callback. */
const ids = new Map<string, number>();
const byId = new Map<number, string>();
let press: JSCallback | undefined;
let handler: ((accelerator: string) => void) | undefined;

function failure(message: string, part?: string): ShortcutResult {
	return part === undefined
		? { ok: false, code: "native-failed", message }
		: { ok: false, code: "native-failed", message, part };
}

/** Install the press channel once and answer its pointer, which C keeps. */
function channel(native: ShortcutUnit): void {
	if (press === undefined) {
		press = new JSCallback(
			(id: number) => {
				const accelerator = byId.get(Number(id));
				if (accelerator === undefined) return 0;
				try {
					handler?.(accelerator);
				} catch {
					// An exception crossing back into Carbon aborts the process.
				}
				return 0;
			},
			{ args: [I32], returns: I32 },
		);
	}
	const raw: unknown = press.ptr;
	const pointer = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (pointer === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	if (native.symbols.shortcut_install(pointer) !== 1) {
		throw new Error("crust: InstallEventHandler refused the hot-key handler");
	}
}

/**
 * The adapter plus its test seam, kept off `ShortcutAdapter` so the plugin's command
 * list cannot reach it: a caller with the plain interface cannot fire a press.
 */
export interface DispatchableShortcuts extends ShortcutAdapter {
	/** Fire a registered accelerator without the keyboard; false for one never registered. */
	dispatch(accelerator: string): boolean;
}

/** The native half of `crust:shortcut`, as an injected adapter. */
export function darwinShortcutsAdapter(): DispatchableShortcuts {
	return {
		register(parsed: ParsedAccelerator): ShortcutResult {
			const keycode = KEYCODES.get(parsed.key);
			if (keycode === undefined) {
				return failure(`shortcut: no virtual keycode for "${parsed.key}"`, parsed.key);
			}
			const modifiers = parsed.modifiers.reduce((mask, one) => mask | MODIFIER_BITS[one], 0);
			let native: ShortcutUnit;
			try {
				native = shortcutUnit();
				channel(native);
			} catch (error) {
				return failure(
					error instanceof Error ? error.message : String(error),
					parsed.accelerator,
				);
			}
			const id = Number(native.symbols.shortcut_register(keycode, modifiers) ?? 0);
			if (id <= 0) {
				return failure(
					`RegisterEventHotKey refused ${parsed.accelerator}`,
					parsed.accelerator,
				);
			}
			ids.set(parsed.accelerator, id);
			byId.set(id, parsed.accelerator);
			return { ok: true, accelerator: parsed.accelerator };
		},

		unregister(parsed: ParsedAccelerator): boolean {
			const id = ids.get(parsed.accelerator);
			if (id === undefined) return false;
			ids.delete(parsed.accelerator);
			byId.delete(id);
			try {
				return Number(shortcutUnit().symbols.shortcut_unregister(id) ?? 0) === 1;
			} catch {
				return false;
			}
		},

		unregisterAll(): number {
			ids.clear();
			byId.clear();
			try {
				return Number(shortcutUnit().symbols.shortcut_unregister_all() ?? 0);
			} catch {
				return 0;
			}
		},

		dispatch(accelerator: string): boolean {
			// The map is the guard: an id reaches C only if this process registered it.
			const id = ids.get(accelerator);
			if (id === undefined) return false;
			try {
				return Number(shortcutUnit().symbols.shortcut_dispatch(id) ?? 0) === 1;
			} catch {
				return false;
			}
		},

		onTrigger(next: (accelerator: string) => void): () => void {
			handler = next;
			return () => {
				if (handler === next) handler = undefined;
			};
		},
	};
}
