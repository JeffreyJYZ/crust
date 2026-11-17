/**
 * The macOS half of `crust:network`'s connectivity pair: `SCNetworkReachability` over `bun:ffi`
 * (`network-status-ffi.ts` compiles `shim/120_network_status.c`).
 *
 * **Why reachability and not `NWPathMonitor`.** `NWPathMonitor` is the modern API, but it needs a
 * `nw_path_monitor_t` object kept alive across threads and a block per update; reachability answers
 * the same question with four scalar symbols and one callback, and its flags already distinguish "a
 * path exists" from "a path exists but something must be dialled first". The observer is scheduled on
 * the main dispatch queue, so the sink arrives on the thread the pump already drives.
 *
 * **The flags are decoded here, not in C.** A flag change is then a one-line edit here instead of a
 * C change plus a recompile, and the numbering is Apple's, documented in `SCNetworkReachability.h`.
 */

import { FFIType, JSCallback, ptr } from "bun:ffi";

import type { NetworkStatus, NetworkStatusAdapter } from "@/plugins/network-status.ts";
import { networkStatusUnit, type NetworkStatusUnit } from "./network-status-ffi.ts";

export {
	networkStatusSource,
	networkStatusUnit,
	type NetworkStatusUnit,
} from "./network-status-ffi.ts";

/** `SCNetworkReachabilityFlags`, the two bits a page cares about. */
export const REACHABILITY_FLAGS = {
	reachable: 1 << 1,
	connectionRequired: 1 << 2,
} as const;

/** How many bytes the interface-kind list may use; four words plus commas fit many times over. */
const KINDS_BUFFER = 128;

/** The reachable-and-not-waiting test. A trapped portal is reachable, and is reported online. */
export function onlineFromFlags(flags: number): boolean {
	if (flags < 0) return false;
	const reachable = (flags & REACHABILITY_FLAGS.reachable) !== 0;
	const needsDial = (flags & REACHABILITY_FLAGS.connectionRequired) !== 0;
	return reachable && !needsDial;
}

function pointerOf(callback: JSCallback): number {
	const raw: unknown = callback.ptr;
	const value = typeof raw === "number" ? raw : typeof raw === "bigint" ? Number(raw) : 0;
	if (value === 0) throw new Error("crust: JSCallback exposed no usable pointer");
	return value;
}

function readKinds(unit: NetworkStatusUnit): string[] {
	const buffer = new Uint8Array(KINDS_BUFFER);
	const length = Number(unit.symbols.ns_kinds(ptr(buffer), buffer.length) ?? -1);
	if (length <= 0) return [];
	const text = new TextDecoder().decode(buffer.subarray(0, Math.min(length, buffer.length)));
	return text.length === 0 ? [] : text.split(",").filter((kind) => kind.length > 0);
}

function readStatus(unit: NetworkStatusUnit): NetworkStatus {
	const flags = Number(unit.symbols.ns_flags() ?? -1);
	return { online: onlineFromFlags(flags), interfaceKinds: readKinds(unit) };
}

/**
 * The adapter. `unit` is a seam so a test can supply a fake symbol table without compiling C or
 * installing a real observer; the real build answers `not-implemented` naming
 * SystemConfiguration when the unit refuses to compile.
 */
export function darwinNetworkStatusAdapter(
	unit: () => NetworkStatusUnit = networkStatusUnit,
): NetworkStatusAdapter {
	let channel: JSCallback | undefined;
	let listener: ((status: NetworkStatus) => void) | undefined;

	return {
		requires: "SCNetworkReachability in SystemConfiguration",
		status: () => readStatus(unit()),
		onChange: (next) => {
			listener = next;
			const symbols = unit().symbols;
			if (channel === undefined) {
				channel = new JSCallback(
					(flags: number) => {
						try {
							const current = readStatus(unit());
							listener?.(current);
						} catch {
							// A throw crossing into the dispatch queue aborts the process.
						}
						void flags;
						return 0;
					},
					{ args: [FFIType.i32], returns: FFIType.i32 },
				);
				symbols.ns_set_sink(pointerOf(channel));
			}
			return Number(symbols.ns_watch() ?? 0) === 1;
		},
	};
}
