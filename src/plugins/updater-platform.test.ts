/**
 * Finding 2: the updater used to be registered on every platform while `install` checked for a
 * macOS `.app` and `relaunch` ran `open -n`. Both now refuse by name off macOS, so a Windows or
 * Linux app cannot advertise an update path that can never finish. The platform is passed in
 * explicitly because this suite runs on macOS, where `process.platform` alone would hide the arm.
 */

import { describe, expect, test } from "bun:test";

import { createUpdaterPlugin } from "@/plugins/updater";
import { offlineAdapter } from "@/plugins/updater-fake";

describe("updater platform gate", () => {
	for (const platform of ["win32", "linux"]) {
		test(`${platform}: install refuses by name and names the platform`, async () => {
			const commands = createUpdaterPlugin(
				offlineAdapter(),
				{},
				process.execPath,
				platform,
			).commands;
			const result = await commands.install({
				path: "/tmp/update.app",
				appPath: "/tmp/App.app",
			});
			expect(result).toMatchObject({ ok: false, code: "unsupported-platform" });
			if (!result.ok) expect(result.message).toContain(platform);
		});

		test(`${platform}: relaunch refuses by name and names the platform`, async () => {
			const commands = createUpdaterPlugin(
				offlineAdapter(),
				{},
				process.execPath,
				platform,
			).commands;
			const result = await commands.relaunch({ appPath: "/tmp/App.app" });
			expect(result).toMatchObject({ ok: false, code: "unsupported-platform" });
			if (!result.ok) expect(result.message).toContain(platform);
		});
	}

	test("darwin is not refused by the platform gate", async () => {
		const commands = createUpdaterPlugin(
			offlineAdapter(),
			{},
			process.execPath,
			"darwin",
		).commands;
		// A bundle that is not this process's own still refuses, but for the bundle reason, not
		// because the platform was gated.
		const result = await commands.relaunch({ appPath: "/tmp/App.app" });
		expect(result).not.toMatchObject({ code: "unsupported-platform" });
	});
});
