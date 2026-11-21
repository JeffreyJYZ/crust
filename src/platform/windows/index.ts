/**
 * The Windows platform's barrel, mirroring the darwin one: the platform, its preflight and the shim
 * source. The backend is exported too, because a caller that wants a different probe (or a test)
 * has to be able to replace it. Nothing here runs on macOS — see `platform.ts`.
 */
export { defaultBackend, type WindowsBackend, type WindowsShim } from "./backend.ts";
export { windowsClipboardAdapter } from "./clipboard.ts";
export { OPENER_STATUS, windowsOpenerAdapter } from "./opener.ts";
export { windowsOsAdapter } from "./os-info.ts";
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
export {
	DIALOG_MAX_PATHS,
	DIALOG_STATUS,
	defaultDialogOwner,
	filterSpec,
	windowsDialogAdapter,
	type WindowsDialogShim,
} from "./dialog.ts";
export {
	PREVIEW_STATUS,
	PREVIEW_STEP,
	isFile,
	previewDetail,
	windowsPreviewHost,
	type PreviewFailure,
	type PreviewOutcome,
	type PreviewRect,
	type PreviewShowOptions,
	type WindowsPreviewHost,
	type WindowsPreviewShim,
} from "./preview.ts";
