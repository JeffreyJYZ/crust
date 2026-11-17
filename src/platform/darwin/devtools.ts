/**
 * The WebKit inspector gate. `crust dev` sets this env flag; the runtime child inherits it, and a
 * built app never carries it. Same shape as the reload-file gate: a value the dev runner owns,
 * read at window creation, so enabling the inspector cannot leak into a shipped bundle.
 */
export const DEV_INSPECT_ENV = "CRUST_DEV_INSPECT";

/** Only the exact value "1" enables the inspector; an absent or stray value never does. */
export function devInspectEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[DEV_INSPECT_ENV] === "1";
}
