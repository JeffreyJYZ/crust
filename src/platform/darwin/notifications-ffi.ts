/**
 * Compile the notifications C unit, once per process. It ships as several parts so none outgrows the line cap and is concatenated here because it is **one translation unit**: the parts share statics (`nf_reason`, `nf_center`, the block descriptors), and separately compiled files would give each part a silent copy.
 * `cc()` compiles C only and frameworks must be linked by name: `-framework UserNotifications` is not optional, it is what makes `UNUserNotificationCenter` resolvable at all.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no `import.meta.dir`, so the C unit travels inside the
// binary as text and is materialised before `cc()` sees it — the same device
// platform/darwin/index.ts uses for the shim.
import prelude from "./notifications/00_prelude.c" with { type: "text" };
import strings from "./notifications/10_strings.c" with { type: "text" };
import bundleId from "./notifications/20_bundle_id.c" with { type: "text" };
import blocks from "./notifications/30_blocks.c" with { type: "text" };
import modern from "./notifications/40_modern.c" with { type: "text" };
import deprecated from "./notifications/50_deprecated.c" with { type: "text" };
import exportsPart from "./notifications/60_exports.c" with { type: "text" };

/** The whole unit as C source, in declaration order, byte-exact as one file. */
export const notificationsSource = [
	prelude,
	strings,
	bundleId,
	blocks,
	modern,
	deprecated,
	exportsPart,
].join("");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const CS = FFIType.cstring;

/** The three exports, as `bun:ffi` hands them back. */
export interface NotificationUnit {
	symbols: {
		crust_notification_post: (title: number, body: number, waitMs: number) => number;
		crust_notification_reason: () => string | null;
		crust_notification_center: () => number;
	};
}

function compile(): NotificationUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(notificationsSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-notifications-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, notificationsSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: [
			"-framework",
			"AppKit",
			"-framework",
			"Foundation",
			"-framework",
			"UserNotifications",
		],
		symbols: {
			crust_notification_post: { args: [P, P, I32], returns: I32 },
			crust_notification_reason: { args: [], returns: CS },
			crust_notification_center: { args: [], returns: I32 },
		},
	}) as unknown as NotificationUnit;
}

let unitOnce: NotificationUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function unit(): NotificationUnit {
	return (unitOnce ??= compile());
}

// A JS string cannot be passed into compiled C, so every `const char *`
// argument gets an encoded buffer whose bytes stay reachable. One per distinct
// string, cached, exactly as platform/darwin/index.ts does it.
const buffers = new Set<Uint8Array>();
const bufferCache = new Map<string, number>();

export function cbuf(text: string): number {
	let cached = bufferCache.get(text);
	if (cached === undefined) {
		const bytes = new TextEncoder().encode(`${text}\0`);
		buffers.add(bytes);
		cached = ptr(bytes);
		bufferCache.set(text, cached);
	}
	return cached;
}

export function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
