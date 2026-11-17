/**
 * The compiled deep-link C unit. Split out of `deep-link.ts` when that file hit
 * the 200-line cap: compilation, content hashing and the FFI symbol table are a
 * responsibility of their own, and only the adapter/argv code stays behind.
 * The lifecycle callbacks live in the same unit (`shim/117_lifecycle.c`
 * concatenated after `shim/95_deeplink.c`), so there is one delegate and one
 * compile, not two.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import deepLinkSource from "./shim/95_deeplink.c" with { type: "text" };
import lifecycleSource from "./shim/117_lifecycle.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const V = FFIType.void;

export interface DeepLinkUnit {
	symbols: {
		crust_deeplink_install: () => number;
		crust_deeplink_last: (dst: number, cap: number) => number;
		crust_deeplink_clear: () => void;
		crust_deeplink_argv: (argc: number, argv: number) => number;
		crust_lifecycle_take: () => number;
		crust_lifecycle_settle: () => number;
		crust_lifecycle_immediate: () => void;
	};
}

function compile(): DeepLinkUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const source = `${deepLinkSource}\n${lifecycleSource}`;
		const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-deeplink-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, source);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		symbols: {
			crust_deeplink_install: { args: [], returns: I32 },
			crust_deeplink_last: { args: [P, I64], returns: I64 },
			crust_deeplink_clear: { args: [], returns: V },
			crust_deeplink_argv: { args: [I32, P], returns: I32 },
			crust_lifecycle_take: { args: [], returns: I32 },
			crust_lifecycle_settle: { args: [], returns: I32 },
			crust_lifecycle_immediate: { args: [], returns: V },
		},
	}) as unknown as DeepLinkUnit;
}

let unitOnce: DeepLinkUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function deepLinkUnit(): DeepLinkUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: deep links need AppKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}
