/**
 * A dev restart rotates the bridge token and breaks the loaded page, so the watch must
 * never treat a frontend asset or an author-named ignore path as backend code. The
 * guard used to be conditional on `dev.url`, which is exactly the project with no
 * dev server that writes captures and renders next to main.ts.
 */
import { describe, expect, test } from "bun:test";
import { validateConfig } from "@/config";
import { isIgnoredWatchPath } from "../ignore.ts";
import { shouldRestartRuntime } from "./runtime.ts";

const base = {
	app: { id: "land.jyz.guard", name: "guard", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

describe("dev watch guard", () => {
	test("a PNG next to main.ts does not restart even with no dev.url", () => {
		expect(shouldRestartRuntime("capture.png", {})).toBe(false);
		expect(shouldRestartRuntime("captures/shot-1.png", {})).toBe(false);
	});

	test("backend source still restarts", () => {
		expect(shouldRestartRuntime("main.ts", {})).toBe(true);
		expect(shouldRestartRuntime("plugins/commands.ts", {})).toBe(true);
	});

	test("dev.ignore names a path the extension list cannot know", () => {
		expect(isIgnoredWatchPath("renders/out.json", ["renders"])).toBe(true);
		expect(shouldRestartRuntime("renders/out.json", { ignore: ["renders"] })).toBe(false);
		expect(shouldRestartRuntime("main.ts", { ignore: ["renders"] })).toBe(true);
	});

	test("dev.ignore is a string array validated at config time", () => {
		const config = validateConfig({ ...base, dev: { ignore: ["renders", "captures"] } });
		expect(config.dev?.ignore).toEqual(["renders", "captures"]);
		expect(() => validateConfig({ ...base, dev: { ignore: [42] } })).toThrow();
	});
});
