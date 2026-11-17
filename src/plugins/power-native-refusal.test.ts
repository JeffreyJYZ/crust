/**
 * `crust:power` proofs for native refusals the adapter reports but the plugin used to flatten into
 * success: a refused sleep release, and a state or idle read the OS never answered. Each fake supplies
 * the signal the darwin adapter carries on its refusal path, so the plugin's typed failure is measured.
 */

import { describe, expect, test } from "bun:test";

import { createPowerPlugin, type PowerAdapter } from "@/plugins/power";

const COMPILE_FAILURE = "the power C unit did not compile";

function base(overrides: Partial<PowerAdapter> = {}): PowerAdapter {
	return {
		state: () => ({ onAc: true, batteryPercent: 80, lowPowerMode: false }),
		idleSeconds: () => 12,
		preventSleep: () => ({ ok: true, id: 1, reason: "assertion held" }),
		allowSleep: () => ({ ok: true, released: true, reason: "assertion released" }),
		...overrides,
	};
}

describe("power native refusals", () => {
	test("a refused release is a typed failure, never a claimed release", async () => {
		const plugin = createPowerPlugin(
			base({
				allowSleep: () => ({
					ok: false,
					released: false,
					reason: "release refused by IOKit",
				}),
			}),
		);
		expect(await plugin.commands.sleepAllow()).toEqual({
			ok: false,
			code: "handler-error",
			message: "release refused by IOKit",
		});
	});

	test("a fabricated state read is a typed failure, not ok: true on wall power", async () => {
		const plugin = createPowerPlugin(
			base({
				state: () => ({
					onAc: false,
					batteryPercent: null,
					lowPowerMode: false,
					available: false,
					reason: COMPILE_FAILURE,
				}),
			}),
		);
		expect(await plugin.commands.state()).toEqual({
			ok: false,
			code: "handler-error",
			message: COMPILE_FAILURE,
		});
	});

	test("a refused idle read is a typed failure, not a fabricated zero", async () => {
		const plugin = createPowerPlugin(
			base({ idleSeconds: () => ({ available: false, reason: COMPILE_FAILURE }) }),
		);
		expect(await plugin.commands.idleSeconds()).toEqual({
			ok: false,
			code: "handler-error",
			message: COMPILE_FAILURE,
		});
	});
});
