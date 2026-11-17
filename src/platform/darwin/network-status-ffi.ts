/**
 * The connectivity unit's C boundary: `shim/120_network_status.c` compiled by `cc()` with
 * SystemConfiguration, in its own translation unit the way `dock-ffi.ts` is, because the network
 * interception unit is already one and its statics must not be joined with these.
 *
 * Only `ns_kinds` returns bytes, so only it needs a buffer; every other symbol answers a number.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import statusPart from "./shim/120_network_status.c" with { type: "text" };

export const networkStatusSource = statusPart;

const P = FFIType.ptr;
const I32 = FFIType.i32;

export interface NetworkStatusUnit {
	symbols: {
		ns_abi: () => number;
		ns_open: () => number;
		ns_flags: () => number;
		ns_set_sink: (sink: number) => void;
		ns_watch: () => number;
		ns_kinds: (dst: number, cap: number) => number;
	};
}

function sourcePath(): string {
	const hash = createHash("sha256").update(networkStatusSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-network-status-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, networkStatusSource);
	return path;
}

function compile(): NetworkStatusUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "SystemConfiguration", "-framework", "Foundation"],
		symbols: {
			ns_abi: { args: [], returns: I32 },
			ns_open: { args: [], returns: I32 },
			ns_flags: { args: [], returns: I32 },
			ns_set_sink: { args: [P], returns: FFIType.void },
			ns_watch: { args: [], returns: I32 },
			ns_kinds: { args: [P, I32], returns: I32 },
		},
	}) as unknown as NetworkStatusUnit;
}

let unitOnce: NetworkStatusUnit | undefined;

/** Compile at most once per process; the file is content-hashed so a relaunch reuses it. */
export function networkStatusUnit(): NetworkStatusUnit {
	return (unitOnce ??= compile());
}
