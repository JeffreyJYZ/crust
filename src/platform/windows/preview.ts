/**
 * The Windows preview host: the shell's `IPreviewHandler`, created for a file and hosted in a child
 * window over the app's. The narrow API is four calls — show, size, hide, and the host handle — plus
 * three named failures, because a page must be able to say "this file type has no preview" rather
 * than show an empty rectangle.
 *
 * **This is not `QLPreviewPanel`.** On macOS a preview floats beside the window and the app owns
 * nothing; here the app owns a child HWND, and the handler paints inside it. So the caller sizes it:
 * a resize is `size`, a window close is `hide`, and a second `show` replaces the first rather than
 * stacking.
 *
 * The C half (`shim/54_preview.c`, `shim/55_preview_init.c`) does the COM sequence; this side refuses
 * the one thing it can know without Windows — a path that is not a file — and turns the shim's status,
 * step and HRESULT into the sentence a caller prints.
 */
import { statSync } from "node:fs";
import { extname } from "node:path";
import { NO_WINDOWS_SHIM, activeWindowsShim } from "./active-shim.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";
import { hresult } from "./platform-config.ts";

/** The shim members this module calls, so a fake supplies six rather than the whole Win32 table. */
export type WindowsPreviewShim = Pick<
	WindowsShim,
	| "shim_preview_show"
	| "shim_preview_hide"
	| "shim_preview_size"
	| "shim_preview_hwnd"
	| "shim_preview_step"
	| "shim_preview_hresult"
>;

/** What `shim_preview_show` answers. Pinned by `preview-ids.test.ts` against the C defines. */
export const PREVIEW_STATUS = { shown: 0, noHandler: 1, failed: 2 } as const;

/**
 * The step names, index-aligned with `SHIM_PREVIEW_STEP_*` in `shim/54_preview.c` — the test decodes
 * those numbers from the C, so a step added on one side cannot silently shift the other.
 */
export const PREVIEW_STEP = [
	"none",
	"resolve",
	"create",
	"initialize",
	"set-window",
	"set-rect",
	"do-preview",
	"host-window",
	"entry-points",
] as const;

/** The three answers a refusal can carry. Anything else is a defect, not a preview that failed. */
export type PreviewFailure = "no-handler" | "preview-failed" | "not-a-file";

export interface PreviewRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PreviewShowOptions extends PreviewRect {
	/** The file to preview. It must exist and be a file; a directory is `not-a-file`. */
	path: string;
	/** The app window's HWND — the parent of the host the handler draws in. */
	parent: number;
}

/**
 * `ok` carries the host HWND so a caller can prove the child exists; a refusal carries the reason and
 * a sentence naming the call that stopped it, which is what a page shows its user.
 */
export type PreviewOutcome =
	| { readonly ok: true; readonly hwnd: number }
	| { readonly ok: false; readonly reason: PreviewFailure; readonly detail: string };

export interface WindowsPreviewHost {
	show(options: PreviewShowOptions): PreviewOutcome;
	size(rect: PreviewRect): boolean;
	hide(): boolean;
	/** The host HWND, 0 when nothing is shown. */
	hwnd(): number;
}

/** One sentence per step, so a `preview-failed` names what Windows refused instead of "it failed". */
const STEP_DETAIL: Record<string, string> = {
	resolve: "the file's registered preview handler could not be read",
	create: "CoCreateInstance refused the registered handler",
	initialize: "the handler refused this file",
	"set-window": "the handler refused its host window",
	"set-rect": "the handler refused its drawing rectangle",
	"do-preview": "the handler failed to render the file",
	"host-window": "the child window could not be created",
	"entry-points": "the preview entry points did not resolve (shlwapi, ole32 or shell32)",
};

/** The step and HRESULT as one line: named where it is known, with the hex a Win32 developer reads. */
export function previewDetail(shim: WindowsPreviewShim): string {
	const index = Number(shim.shim_preview_step() ?? 0);
	const kind = Number(shim.shim_preview_hresult() ?? 0);
	const step = PREVIEW_STEP[index] ?? `step-${index}`;
	const sentence = STEP_DETAIL[step] ?? `the preview stopped at ${step}`;
	return kind === 0 ? sentence : `${sentence} (${hresult(kind)})`;
}

// A strong reference for the duration of one call: `bun:ffi` reads the bytes during the call, and a
// local `Uint8Array` may be collected before it returns.
let pinned: Uint8Array | undefined;

/**
 * Is this something a preview handler could open? `statSync` rather than `existsSync`: a directory
 * exists and is not previewable, and answering `preview-failed` for it would blame the platform.
 */
export function isFile(path: string): boolean {
	const stat = statSync(path, { throwIfNoEntry: false });
	return stat !== undefined && stat.isFile();
}

/** The reasons a path with no handler is worded with, so the sentence names the extension. */
function noHandlerDetail(path: string): string {
	const extension = extname(path);
	return extension.length > 0
		? `no preview handler is registered for ${extension} files`
		: "no preview handler is registered for a file with no extension";
}

/**
 * Build the host. The shim is asked per call, never held: a registry can build this before
 * `app.run()` has compiled one, and a Linux or test process never will.
 */
export function windowsPreviewHost(
	native: () => WindowsPreviewShim | undefined = activeWindowsShim,
): WindowsPreviewHost {
	const shimFor = (): WindowsPreviewShim => {
		const shim = native();
		if (shim === undefined) throw new Error(NO_WINDOWS_SHIM);
		return shim;
	};

	const show = (options: PreviewShowOptions): PreviewOutcome => {
		if (!isFile(options.path)) {
			return { ok: false, reason: "not-a-file", detail: `no file at ${options.path}` };
		}
		const shim = shimFor();
		const bytes = cstring(options.path);
		pinned = bytes;
		const status = Number(
			shim.shim_preview_show(
				bytes,
				bytes.length - 1,
				options.parent,
				options.x,
				options.y,
				options.width,
				options.height,
			) ?? PREVIEW_STATUS.failed,
		);
		if (status === PREVIEW_STATUS.shown) {
			const hwnd = Number(shim.shim_preview_hwnd() ?? 0);
			// A "shown" with no window is the shim contradicting itself, and a caller that trusted it
			// would believe a preview exists. Name it instead of returning a handle of 0.
			return hwnd > 0
				? { ok: true, hwnd }
				: {
						ok: false,
						reason: "preview-failed",
						detail: "the shim reported a preview with no host window",
					};
		}
		if (status === PREVIEW_STATUS.noHandler) {
			return { ok: false, reason: "no-handler", detail: noHandlerDetail(options.path) };
		}
		return { ok: false, reason: "preview-failed", detail: previewDetail(shim) };
	};

	const size = (rect: PreviewRect): boolean =>
		Number(shimFor().shim_preview_size(rect.x, rect.y, rect.width, rect.height) ?? 0) === 1;

	const hide = (): boolean => Number(shimFor().shim_preview_hide() ?? 0) === 1;

	const hwnd = (): number => Number(shimFor().shim_preview_hwnd() ?? 0);

	return { show, size, hide, hwnd };
}
