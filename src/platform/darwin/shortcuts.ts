/**
 * macOS global shortcuts: the accelerator grammar lives in `plugins/shortcuts.ts`; this file is the OS half, a `RegisterEventHotKey` unit compiled at launch from `shim/93_shortcuts.c` the way the tray compiles its own (`cc()`, no artifact, no Xcode, Carbon linked by name).
 * The press reaches JavaScript the way a tray click does: the C event handler calls the `JSCallback` this module installs once, and the id it carries is mapped back to a canonical accelerator here, so no Carbon object is ever held on the JS side.
 */

import { cc, FFIType, JSCallback } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ParsedAccelerator,
	ShortcutAdapter,
	ShortcutModifier,
	ShortcutResult,
} from "@/plugins/shortcuts";
import source from "./shim/93_shortcuts.c" with { type: "text" };

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
	};
}

// Virtual keycodes, `kVK_*` from HIToolbox Events.h, as `<name>:<hex>` pairs. One
// encoded table rather than ninety object rows, because the table is data and the
// cap is 200 lines.
const KEYCODE_TABLE =
	"a:00 s:01 d:02 f:03 h:04 g:05 z:06 x:07 c:08 v:09 b:0b q:0c w:0d e:0e r:0f " +
	"y:10 t:11 1:12 2:13 3:14 4:15 6:16 5:17 =:18 9:19 7:1a -:1b 8:1c 0:1d ]:1e " +
	"[:21 ':27 ;:29 \\:2a ,:2b /:2c .:2f `:32 o:1f u:20 i:22 p:23 l:25 j:26 k:28 " +
	"n:2d m:2e enter:24 tab:30 space:31 backspace:33 escape:35 forwarddelete:75 " +
	"insert:72 home:73 end:77 pageup:74 pagedown:79 up:7e down:7d left:7b right:7c " +
	"f1:7a f2:78 f3:63 f4:76 f5:60 f6:61 f7:62 f8:64 f9:65 f10:6d f11:67 f12:6f " +
	"f13:69 f14:6b f15:71 f16:6a f17:40 f18:4f f19:50";

const KEYCODES: ReadonlyMap<string, number> = new Map(
	KEYCODE_TABLE.split(" ").map((pair) => {
		const at = pair.indexOf(":");
		return [pair.slice(0, at), Number.parseInt(pair.slice(at + 1), 16)] as const;
	}),
);

/** Carbon's modifier mask — `cmdKey` 1<<8 and friends, not NSEvent's flags. */
const MODIFIER_BITS: Record<ShortcutModifier, number> = {
	command: 1 << 8,
	shift: 1 << 9,
	option: 1 << 11,
	control: 1 << 12,
};

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

/** The native half of `crust:shortcut`, as an injected adapter. */
export function darwinShortcutsAdapter(): ShortcutAdapter {
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

		onTrigger(next: (accelerator: string) => void): () => void {
			handler = next;
			return () => {
				if (handler === next) handler = undefined;
			};
		},
	};
}
