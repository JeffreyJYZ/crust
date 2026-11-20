/**
 * WebView2's user-data folder, owned by this harness and emptied before a run.
 *
 * A folder a previous process still holds is one of the two documented ways
 * `CreateCoreWebView2Controller` answers `E_ABORT`, and a CI step that reuses a folder its last run
 * left behind is exactly the state that cannot be told from a runtime fault. Deleting it makes the
 * folder provably fresh, so the abort this smoke retries has one cause left rather than two.
 *
 * Best-effort: a lingering `msedgewebview2.exe` can refuse the delete, and that refusal is not this
 * run's failure to report — the line says the folder stayed, and the run continues.
 */
import { rmSync } from "node:fs";

/** Empty the folder, printing when it could not be removed. */
export function freshUserData(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		console.log(`userdata  ${dir} stayed in place (a browser process still holds it)`);
	}
}
