/**
 * `testing.activation` as process state: the launch policy a probe run wants.
 *
 * It lives in one module because both halves of the launch read it and neither owns the other: the
 * platform decides whether a window create may raise the app, and the accessibility plugin decides
 * whether a tree read may answer. Keeping it here means one value, set once by the runtime before
 * the platform exists, rather than a config threaded through five constructors.
 *
 * `auto` is an ordinary launch and is the default, so an app with no `testing` section behaves
 * exactly as it did. `none` and `on-demand` both suppress launch activation — that is the whole
 * point, a probe must not steal the front — and differ only in what an accessibility read does:
 * `none` refuses with `needs-activation`, `on-demand` activates once and then answers.
 */

import type { ActivateMode, TestingActivation } from "@/config";

let configured: TestingActivation = "auto";
/** Process-wide: `on-demand` means the first read that needs the app active, not one per plugin. */
let demanded = false;
/** The platform's one activation call, installed by the runtime's darwin arm. */
let raise: (() => void) | undefined;

/** Record the config's policy. Absent is `auto`, which is today's launch. */
export function setTestingActivation(mode: TestingActivation | undefined): void {
	configured = mode ?? "auto";
}

/** Install the call `on-demand` makes. Absent on a platform with no activation concept. */
export function setActivationRaise(fn: (() => void) | undefined): void {
	raise = fn;
}

export function testingActivation(): TestingActivation {
	return configured;
}

/** Test seam: one process, one launch policy, and a suite must be able to start over. */
export function resetActivationPolicy(): void {
	configured = "auto";
	demanded = false;
	raise = undefined;
}

/**
 * The `app.activate` a platform should run under. `auto` leaves the config's own value alone;
 * either probe mode answers `never`, so no window create sends an activation selector.
 */
export function launchActivateMode(mode: ActivateMode | undefined): ActivateMode | undefined {
	return configured === "auto" ? mode : "never";
}

/** True when an accessibility read must refuse by name rather than answer an empty tree. */
export function activationRefused(): boolean {
	return configured === "none";
}

/**
 * The one activation an `on-demand` run allows, for the first call that needs the app active.
 * `auto` already activated at launch and `none` never may, so both are no-ops.
 */
export function demandActivation(): void {
	if (configured !== "on-demand" || demanded || raise === undefined) return;
	demanded = true;
	raise();
}
