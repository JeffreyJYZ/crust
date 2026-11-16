/**
 * Compile the network C unit, once per process. It is two parts and ONE translation unit —
 * `shim/110_network.c` (the handler class, the decision, the registration) and
 * `shim/113_network_serve.c` (the byte serving, which uses the first part's statics), joined the
 * way `navigation-unit.ts` joins its halves. The source travels inside the binary as text,
 * because a compiled binary has no readable `import.meta.dir`.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import handler from "./shim/110_network.c" with { type: "text" };
import serve from "./shim/113_network_serve.c" with { type: "text" };

/** The two parts as one translation unit. */
export const networkSource = [handler, serve].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

export interface NetworkUnit {
	symbols: {
		net_abi: () => number;
		net_install: (
			configuration: number,
			bytes: number,
			length: number,
			decide: number,
			fill: number,
		) => number;
		net_installed: () => number;
		/** The URL of the current decision, as a byte range into a caller-owned buffer. */
		net_url: (dst: number, cap: number) => number;
		/** Bytes delivered through the scheme since launch, and how many tasks answered. */
		net_served: () => number;
		net_tasks: () => number;
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
			net_install: { args: [P, P, I64, P, P], returns: I32 },
			net_installed: { args: [], returns: I32 },
			net_url: { args: [P, I32], returns: I32 },
			net_served: { args: [], returns: I64 },
			net_tasks: { args: [], returns: I32 },
		},
	}) as unknown as NetworkUnit;
}

let unitOnce: NetworkUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function networkUnit(): NetworkUnit {
	return (unitOnce ??= compile());
}
