/**
 * The macOS platform's one entry point, split out of `platform.ts` when that file crossed the
 * 200-line cap. The fix for a cap is another file, never a trimmed comment.
 */
import { type Activation } from "./activation.ts";
import { DarwinPlatform } from "./platform.ts";

/**
 * Build the macOS platform: `appName` names failures, `activate` is `app.activate` (`always` when
 * omitted — that is what puts a window in the accessibility tree), `icon` is `app.icon`.
 */
export function createPlatform(
	options: {
		appName?: string;
		activate?: Activation["mode"];
		/** `app.icon`, applied to the dock so a dev launch and a built app look the same. */
		icon?: string;
	} = {},
): DarwinPlatform {
	return new DarwinPlatform(options);
}
