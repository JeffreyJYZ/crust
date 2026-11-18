/**
 * The no-adapter refusal names the platform's own power API. `platform` is injectable the way
 * `createKeychainPlugin` injects it, so a suite on macOS can pin Linux and Windows without a CI matrix.
 */

import { describe, expect, test } from "bun:test";

import { createPowerPlugin } from "@/plugins/power.ts";

const POWER_API = {
	darwin: "IOPSCopyPowerSourcesInfo",
	win32: "RegisterPowerSettingNotification in User32.dll",
	linux: "UPower on D-Bus (org.freedesktop.UPower)",
} as const;

/** The refusal, pinned to a platform through the injectable argument. */
async function refuse(platform: string) {
	return (createPowerPlugin(undefined, platform).commands.state as () => Promise<unknown>)();
}

describe("power refusals name the platform's power API", () => {
	test("darwin names IOKit and its bound power-source function", async () => {
		const needs = POWER_API.darwin;
		expect(await refuse("darwin")).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`power.state needs ${needs}`),
		});
	});

	test("win32 names RegisterPowerSettingNotification, not IOKit", async () => {
		const needs = POWER_API.win32;
		const answer = await refuse("win32");
		expect(answer).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`power.state needs ${needs}`),
		});
		expect(answer).not.toMatchObject({ requires: POWER_API.darwin });
	});

	test("linux names UPower over D-Bus, not IOKit", async () => {
		const needs = POWER_API.linux;
		const answer = await refuse("linux");
		expect(answer).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`power.state needs ${needs}`),
		});
		expect(answer).not.toMatchObject({ requires: POWER_API.darwin });
	});
});
