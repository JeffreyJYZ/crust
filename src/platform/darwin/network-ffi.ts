/**
 * Compile the network C unit, once per process. It is one part and one translation unit
 * (`shim/110_network.c`): the handler class, its instance and the decision pointer are statics, and
 * a static is private to its unit. The source travels inside the binary as text, because a compiled
 * binary has no readable `import.meta.dir`.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import part from "./shim/110_network.c" with { type: "text" };

/** The unit as one translation unit; it is a single part, so this is byte-exact. */
export const networkSource = part;

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const CS = FFIType.cstring;

export interface NetworkUnit {
	symbols: {
		net_abi: () => number;
		net_install: (
			configuration: number,
			bytes: number,
			length: number,
			decide: number,
		) => number;
		net_installed: () => number;
		net_url: () => string | null;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's per-path cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(networkSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-network-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, networkSource);
	return path;
}

function compile(): NetworkUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			net_abi: { args: [], returns: I32 },
			net_install: { args: [P, P, I64, P], returns: I32 },
			net_installed: { args: [], returns: I32 },
			net_url: { args: [], returns: CS },
		},
	}) as unknown as NetworkUnit;
}

let unitOnce: NetworkUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function networkUnit(): NetworkUnit {
	return (unitOnce ??= compile());
}
