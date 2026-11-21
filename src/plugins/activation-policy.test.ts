import { beforeEach, describe, expect, test } from "bun:test";

import {
	activationRefused,
	demandActivation,
	launchActivateMode,
	resetActivationPolicy,
	setActivationRaise,
	setTestingActivation,
	testingActivation,
} from "./activation-policy.ts";

describe("testing.activation", () => {
	beforeEach(() => {
		resetActivationPolicy();
	});

	test("defaults to auto, which leaves app.activate untouched", () => {
		expect(testingActivation()).toBe("auto");
		expect(activationRefused()).toBe(false);
		expect(launchActivateMode("always")).toBe("always");
		expect(launchActivateMode(undefined)).toBeUndefined();
	});

	test("none and on-demand both suppress launch activation", () => {
		for (const mode of ["none", "on-demand"] as const) {
			setTestingActivation(mode);
			expect(launchActivateMode("always")).toBe("never");
			expect(launchActivateMode("first")).toBe("never");
		}
	});

	test("none refuses an accessibility read and never raises", () => {
		setTestingActivation("none");
		expect(activationRefused()).toBe(true);
		let raised = 0;
		setActivationRaise(() => raised++);
		demandActivation();
		expect(raised).toBe(0);
	});

	test("on-demand raises exactly once across every later call", () => {
		setTestingActivation("on-demand");
		expect(activationRefused()).toBe(false);
		let raised = 0;
		setActivationRaise(() => raised++);
		demandActivation();
		demandActivation();
		demandActivation();
		expect(raised).toBe(1);
	});

	test("auto never raises on its own: the window create already did it", () => {
		let raised = 0;
		setActivationRaise(() => raised++);
		demandActivation();
		expect(raised).toBe(0);
	});

	test("on-demand with no raise installed is a no-op, not a crash", () => {
		setTestingActivation("on-demand");
		expect(() => demandActivation()).not.toThrow();
	});

	test("reset returns a suite to auto and forgets the one demand", () => {
		setTestingActivation("on-demand");
		let raised = 0;
		setActivationRaise(() => raised++);
		demandActivation();
		resetActivationPolicy();
		expect(testingActivation()).toBe("auto");
		setTestingActivation("on-demand");
		setActivationRaise(() => raised++);
		demandActivation();
		expect(raised).toBe(2);
	});
});
