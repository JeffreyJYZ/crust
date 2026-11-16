/**
 * The Windows platform's barrel, mirroring the darwin one: the platform, its preflight and the shim
 * source. The backend is exported too, because a caller that wants a different probe (or a test)
 * has to be able to replace it. Nothing here runs on macOS — see `platform.ts`.
 */
export { defaultBackend, type WindowsBackend, type WindowsShim } from "./backend.ts";
export { createPlatform, WindowsPlatform } from "./platform.ts";
export {
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	type WindowsPlatformConfig,
	absoluteUrl,
	hresult,
	objectStateName,
} from "./platform-config.ts";
export {
	PREFLIGHT,
	preflightError,
	WEBVIEW2_BOOTSTRAPPER_URL,
	type PreflightEntry,
	type WindowsRuntimeReport,
} from "./preflight.ts";
export { SHIM_PART_NAMES, SHIM_PART_PATHS, SHIM_PARTS, shimSource } from "./shim-source.ts";
