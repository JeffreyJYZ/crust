/**
 * The one retry in this harness, and the line that keeps it from hiding a defect.
 *
 * `E_ABORT` (0x80004004) reaching the controller's completion handler with `environment callback 0x0`
 * is a runtime that aborted its own controller creation while the environment was healthy. The two
 * causes Microsoft documents for it are a parent window destroyed mid-creation and a second environment
 * over one user-data folder — and both are *excluded* by that same line, because a destroyed parent is
 * a window this smoke never destroys and a held folder fails the environment callback, not the
 * controller's. So a cold runtime that has not finished starting `msedgewebview2.exe` is what is left,
 * which is why the retry is bounded to one attempt and has to name this exact HRESULT to be taken:
 * any other controller failure is a finding and is reported as one, never retried.
 */
import type { WindowOptions } from "../../src/app.ts";
import type { WindowsPlatform } from "../../src/platform/windows/index.ts";

export const CONTROLLER_ABORT = "0x80004004";

/**
 * Whether a thrown controller failure is the cold-runtime abort. `environment callback 0x0` is
 * load-bearing: an environment that failed means the user-data folder is the problem, and a retry
 * would only repeat it.
 */
export function isColdControllerAbort(text: string): boolean {
	return (
		text.startsWith("WebView2 controller failed") &&
		text.includes(`controller callback ${CONTROLLER_ABORT}`) &&
		text.includes("environment callback 0x0")
	);
}

/** The line a retry prints: the failure verbatim, then what is being done about it and why. */
export function retryNotice(text: string): string {
	const [first = text] = text.split("\n");
	return (
		`retry     ${first} — the runtime aborted its controller before its browser process was up; ` +
		"creating the window once more (one retry, E_ABORT with a healthy environment only)"
	);
}

/** A thrown value as the text the smoke reports. */
function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Create the window, retrying exactly once for the cold-runtime abort and never for anything else.
 * Returns the failure text when both attempts failed, `undefined` when the window exists — so the
 * caller reports a genuine refusal as a finding and a retried cold start as nothing at all.
 */
export function createWithAbortRetry(
	platform: WindowsPlatform,
	options: WindowOptions,
): string | undefined {
	const attempt = (): string | undefined => {
		try {
			platform.createWindow(options);
			return undefined;
		} catch (error) {
			return reason(error);
		}
	};
	const first = attempt();
	if (first === undefined || !isColdControllerAbort(first)) return first;
	console.log(retryNotice(first));
	return attempt();
}
