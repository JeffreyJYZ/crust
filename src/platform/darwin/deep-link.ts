/**
 * The native half of `crust:deep-link` on macOS: an app delegate that answers `application:openURLs:`, plus the argv scan for a launch that never gets an Apple Event. Its own C unit (`shim/95_deeplink.c`), compiled alone like the clipboard's, because a compiled binary has no source tree.
 * **A URL crosses only as bytes.** The delegate copies into a static C buffer, `last` reports the full length so a caller re-reads at the exact size, and nothing but an int or a length returns. The delegate is unretained by AppKit, so the C unit keeps the only reference.
 */

import { ptr } from "bun:ffi";

// The C unit is compiled and hashed in `deep-link-unit.ts`, split out when this
// file crossed the 200-line cap. Only the adapter and argv code stays here.
export { deepLinkUnit } from "./deep-link-unit.ts";
import { deepLinkUnit } from "./deep-link-unit.ts";

/**
 * The install statuses and their reasons moved to `deep-link-status.ts` when this file crossed the
 * 200-line cap. Re-exported so every caller and test keeps importing them from here.
 */
export { DEEPLINK_STATUS, installReason } from "./deep-link-status.ts";
import { DEEPLINK_STATUS, installReason } from "./deep-link-status.ts";

/**
 * One `char **` for C: NUL-terminated, one pointer per argument, and the
 * encoded buffers returned so the caller can keep them alive across the call.
 */
export function argvTable(args: readonly string[]): {
	count: number;
	table: BigUint64Array;
	keep: Uint8Array[];
} {
	const keep = args.map((arg) => new TextEncoder().encode(`${arg}\0`));
	const table = new BigUint64Array(keep.length + 1);
	for (const [index, bytes] of keep.entries()) table[index] = BigInt(ptr(bytes));
	return { count: keep.length, table, keep };
}

/** The C half, named so a test can drive the adapter with a fake. */
export interface DeepLinkShim {
	/** The C unit's status; 0 installed. */
	install(): number;
	/** UTF-8 bytes into `into`, the full length, -1 for nothing recorded. */
	last(into: Uint8Array): number;
	clear(): void;
	/** 1 when one argument looked like a URL and was recorded. */
	argv(args: readonly string[]): number;
}

/** The real shim: one call per method, buffers built here. */
export function darwinDeepLinkShim(): DeepLinkShim {
	const unit = () => deepLinkUnit();
	return {
		install: () => Number(unit().symbols.crust_deeplink_install() ?? DEEPLINK_STATUS.missing),
		last: (into) => Number(unit().symbols.crust_deeplink_last(ptr(into), into.length) ?? -1),
		clear: () => unit().symbols.crust_deeplink_clear(),
		argv: (args) => {
			// `table.keep` holds the encoded bytes alive until C has returned; only
			// the pointer array itself is dereferenced across the call.
			const table = argvTable(args);
			if (table.count === 0) return 0;
			return Number(unit().symbols.crust_deeplink_argv(table.count, ptr(table.table)) ?? 0);
		},
	};
}

/** The first buffer size; anything longer is re-read at its exact length. */
export const URL_CHUNK = 4 * 1024;

export interface DeepLinkAdapter {
	/** Install the delegate; call after `platform.start()`, before any window. */
	install(): { status: number; reason: string };
	/** The URL this process was launched with: argv first, else one already recorded. */
	takeLaunchUrl(): string | null;
	/** The newest URL recorded since the last drain, or null when there is none. */
	takePendingUrl(): string | null;
}

/**
 * Build the adapter. The unit compiles on the first call, not when this runs, so
 * importing it never links AppKit.
 */
export function darwinDeepLinkAdapter(
	/** The deep-link shim; overridable so a test can drive this with fakes. */
	native: DeepLinkShim = darwinDeepLinkShim(),
	/** The process arguments to scan; `process.argv` unless a test says otherwise. */
	args: readonly string[] = process.argv,
): DeepLinkAdapter {
	const read = (): string | null => {
		let buffer = new Uint8Array(URL_CHUNK);
		let length = native.last(buffer);
		if (length < 0) return null;
		// The buffer was too small for the URL, so ask again with an exact one
		// rather than handing back a truncated link.
		if (length > buffer.length - 1) {
			buffer = new Uint8Array(length + 1);
			length = native.last(buffer);
			if (length < 0) return null;
		}
		const bytes = Math.min(length, buffer.length - 1);
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	};

	return {
		install: () => {
			const status = native.install();
			return { status, reason: installReason(status) };
		},
		takeLaunchUrl: () => {
			native.argv(args);
			return read();
		},
		takePendingUrl: () => {
			const url = read();
			if (url !== null) native.clear();
			return url;
		},
	};
}

/** Install the delegate, so a later URL reaches the buffer instead of being dropped. */
export function installDeepLinkHandler(native: DeepLinkShim = darwinDeepLinkShim()): {
	status: number;
	reason: string;
} {
	return darwinDeepLinkAdapter(native).install();
}

/** The URL this launch carried, and null when it carried none. */
export function takeLaunchUrl(
	native: DeepLinkShim = darwinDeepLinkShim(),
	args: readonly string[] = process.argv,
): string | null {
	return darwinDeepLinkAdapter(native, args).takeLaunchUrl();
}
