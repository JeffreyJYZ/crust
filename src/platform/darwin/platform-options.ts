/**
 * The macOS platform's constructor options, split out of `platform.ts` when that file reached the
 * 200-line cap. The factory and the class share this one shape rather than two copies that drift.
 */
import type { Activation } from "./activation.ts";

export interface DarwinOptions {
	appName?: string;
	activate?: Activation["mode"];
	/** `app.icon`, applied to the dock so a dev launch and a built app look the same. */
	icon?: string;
	/** `security.microphone`: grant the microphone to every window's `getUserMedia`. */
	microphone?: boolean;
}
