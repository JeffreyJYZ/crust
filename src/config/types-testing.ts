/**
 * The probe policy's vocabulary, split from `types.ts` so that file stays under the line cap.
 *
 * `testing.activation` is how a probe run treats the app's activation. `auto` (the default) is an
 * ordinary launch, where `app.activate` decides. `none` never activates at launch, and an
 * accessibility read that needs an active app answers `needs-activation` instead of an empty tree.
 * `on-demand` also launches without activating, and the first accessibility read that needs the app
 * active raises it exactly once. Page-level testing (`testing.*`, `window.capture`) needs no
 * activation in any of the three modes.
 */
export type TestingActivation = "auto" | "none" | "on-demand";

/** The probe config section; only `activation` today, read on every platform. */
export interface TestingConfig {
	/** Defaults to `auto`. */
	activation?: TestingActivation;
}
