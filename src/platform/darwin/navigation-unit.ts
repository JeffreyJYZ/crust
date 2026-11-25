/**
 * The navigation C unit: `shim/107_navigation.c` (the runtime `WKNavigationDelegate` and its
 * sink) joined with `shim/109_navigation_state.c` (the state reads, the history sends and the
 * webview lookup) into one translation unit, exactly as `opener.ts` joins its two halves —
 * the second part uses the first's `nav_has`, `nav_copy` and `nav_error`.
 * Compiled at launch by `cc()`, so there is no native artifact and no Xcode. Every export
 * crosses as an int, a byte range or an opaque pointer: no object and no struct does.
 */

import { cc, FFIType, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C units travel inside the
// binary as text and are materialised before `cc()` sees them.
import delegatePart from "./shim/107_navigation.c" with { type: "text" };
import installPart from "./shim/107_navigation_install.c" with { type: "text" };
import policyPart from "./shim/110_navigation_policy.c" with { type: "text" };
import statePart from "./shim/109_navigation_state.c" with { type: "text" };

/** The four halves as one translation unit; the policy IMP needs the delegate's helpers. */
export const navigationSource = [delegatePart, policyPart, statePart, installPart].join("\n");

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;
const V = FFIType.void;

/** `crust_nav_install`'s answers; `installed` is the only one a caller accepts. */
export const NAVIGATION_STATUS = {
	installed: 0,
	missing: 1,
	noClass: 3,
	alreadyInstalled: 4,
	delegateTaken: 5,
} as const;

const REASONS: Record<number, string> = {
	[NAVIGATION_STATUS.installed]:
		"the delegate is installed and reports every navigation callback",
	[NAVIGATION_STATUS.missing]: "the webview is missing, or has no -setNavigationDelegate:",
	[NAVIGATION_STATUS.noClass]: "the CrustNavigationDelegate class could not be built",
	[NAVIGATION_STATUS.alreadyInstalled]:
		"this webview already carries a crust navigation delegate",
	[NAVIGATION_STATUS.delegateTaken]:
		"another navigation delegate is already set; refusing to replace it and lose its callbacks",
};

/** Why an install answered what it did, including a status this build does not know. */
export function navigationInstallReason(status: number): string {
	return REASONS[status] ?? `unknown status ${status} while installing the navigation delegate`;
}

/** The exports, as `bun:ffi` hands them back; `NavigationNative` is the seam a fake replaces. */
export interface NavigationUnit {
	symbols: {
		crust_nav_set_sink: (sink: number) => void;
		crust_nav_set_decision_sink: (sink: number) => void;
		crust_nav_decision_url: (dst: number, cap: number) => number;
		crust_nav_install: (web: number) => number;
		crust_nav_uninstall: (web: number) => number;
		crust_nav_url: (web: number, dst: number, cap: number) => number;
		crust_nav_title: (web: number, dst: number, cap: number) => number;
		crust_nav_error: (dst: number, cap: number) => number;
		crust_nav_loading: (web: number) => number;
		crust_nav_can_go_back: (web: number) => number;
		crust_nav_can_go_forward: (web: number) => number;
		crust_nav_reload: (web: number) => number;
		crust_nav_load_url: (web: number, bytes: Uint8Array, len: number) => number;
		crust_nav_go_back: (web: number) => number;
		crust_nav_go_forward: (web: number) => number;
		crust_nav_webview: (window: number) => number;
		/** Bitmask of the six delegate callbacks, 63 for all of them. */
		crust_nav_class_ready: () => number;
	};
}

export type NavigationNative = NavigationUnit["symbols"];

function compile(): NavigationUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	const hash = createHash("sha256").update(navigationSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-navigation-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, navigationSource);
	return cc({
		source: file,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			crust_nav_set_sink: { args: [P], returns: V },
			crust_nav_set_decision_sink: { args: [P], returns: V },
			crust_nav_decision_url: { args: [P, I64], returns: I64 },
			crust_nav_install: { args: [P], returns: I32 },
			crust_nav_uninstall: { args: [P], returns: I32 },
			crust_nav_url: { args: [P, P, I64], returns: I64 },
			crust_nav_title: { args: [P, P, I64], returns: I64 },
			crust_nav_error: { args: [P, I64], returns: I64 },
			crust_nav_loading: { args: [P], returns: I32 },
			crust_nav_can_go_back: { args: [P], returns: I32 },
			crust_nav_can_go_forward: { args: [P], returns: I32 },
			crust_nav_reload: { args: [P], returns: I32 },
			crust_nav_load_url: { args: [P, P, I64], returns: I32 },
			crust_nav_go_back: { args: [P], returns: I32 },
			crust_nav_go_forward: { args: [P], returns: I32 },
			crust_nav_webview: { args: [P], returns: P },
			crust_nav_class_ready: { args: [], returns: I32 },
		},
	}) as unknown as NavigationUnit;
}

let unitOnce: NavigationUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function navigationUnit(): NavigationUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: navigation needs WebKit, and this is ${process.platform}`);
	}
	return (unitOnce ??= compile());
}

/** The first buffer size; anything longer is re-read at its exact length. */
export const TEXT_CHUNK = 1024;

/**
 * One field as text. A short buffer is re-read at the exact length the C side reported,
 * because a truncated URL reported as the page's address is worse than no answer.
 */
export function readText(call: (into: Uint8Array) => number): string {
	let buffer = new Uint8Array(TEXT_CHUNK);
	let length = call(buffer);
	if (length < 0) return "";
	if (length > buffer.length - 1) {
		buffer = new Uint8Array(length + 1);
		length = call(buffer);
		if (length < 0) return "";
	}
	return new TextDecoder().decode(buffer.subarray(0, Math.min(length, buffer.length - 1)));
}

/** The WKWebView inside a window, so a caller holding only the window pointer can reach it. */
export function darwinNavigationWebview(window: number): number {
	return Number(navigationUnit().symbols.crust_nav_webview(window) ?? 0);
}

/** A field of a webview as text, through one of the two buffer-taking exports. */
export function webviewText(
	call: (web: number, dst: number, cap: number) => number,
	view: number,
): string {
	return readText((into) => Number(call(view, ptr(into), into.length) ?? -1));
}

/** A field the unit owns rather than a webview, e.g. the last failure's message. */
export function unitText(call: (dst: number, cap: number) => number): string {
	return readText((into) => Number(call(ptr(into), into.length) ?? -1));
}
