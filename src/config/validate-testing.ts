import type { Validator } from "./validator.ts";

export const TESTING_ACTIVATIONS = ["auto", "none", "on-demand"] as const;

/**
 * `testing.activation` is an enum, not free text: `auto` is an ordinary launch, `none` never
 * activates, and `on-demand` activates once for the first accessibility read that needs it. A
 * misspelling would otherwise read as "some string" and silently fall back to `auto` — the exact
 * focus theft the section exists to stop — so it is refused here naming the accepted set.
 */
export function validateTesting(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const testing = v.object("testing", value);
	if (!testing) return;
	v.only(testing, "testing", ["activation"]);
	const activation = testing.activation;
	if (activation === undefined) return;
	if (
		typeof activation !== "string" ||
		!(TESTING_ACTIVATIONS as readonly string[]).includes(activation)
	) {
		v.fail(
			"testing.activation",
			`one of ${TESTING_ACTIVATIONS.map((mode) => `"${mode}"`).join(", ")}`,
			activation,
		);
	}
}
