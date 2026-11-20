/**
 * The macOS platform's one entry point, split out of `platform.ts` when that file crossed the
 * 200-line cap. The fix for a cap is another file, never a trimmed comment.
 */
import type { DarwinOptions } from "./platform-options.ts";
import { DarwinPlatform } from "./platform.ts";

/**
 * Build the macOS platform: `appName` names failures, `activate` is `app.activate` (`always` when
 * omitted — that is what puts a window in the accessibility tree), `icon` is `app.icon`.
 * `microphone` is `security.microphone`: a built bundle carries the purpose string, while
 * `crust dev` is unbundled, so macOS has no `Info.plist` to read and capture there is refused.
 */
export function createPlatform(options: DarwinOptions = {}): DarwinPlatform {
	return new DarwinPlatform(options);
}
