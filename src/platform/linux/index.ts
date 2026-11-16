/**
 * Linux platform implementation: GTK3 + WebKitGTK over `bun:ffi`, no native artifact. The C shim is compiled at launch and reaches both libraries through `dlopen`, so a machine without them gets the preflight text instead of a crash; `site/app/docs/design/page.mdx` explains the shim and the pump.
 * UNPROVEN ON REAL GTK — written on macOS, where the libraries do not exist. What the tests prove is the shape: the five methods, the pump interval, the preflight text and the guarded load.
 */
export { createGtkBackend, type LinuxBackend, type NativeWindow } from "./backend.ts";
export { createPlatform, LinuxPlatform } from "./platform.ts";
export {
	dlopenProbe,
	INSTALL_LINE,
	PREFLIGHT,
	preflightError,
	preflightErrors,
	type PreflightEntry,
	type LibraryProbe,
} from "./preflight.ts";
export { shim } from "./shim-ffi.ts";
export { SHIM_PARTS, SHIM_PART_NAMES, SHIM_PART_PATHS, shimSource } from "./shim-source.ts";
