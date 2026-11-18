/**
 * The dev watch's directory set. A configured `native/` must be in it: editing native/clock.c and
 * rebuilding the dylib has to restart the runtime just like a backend edit, or the rebuilt
 * extension never reaches the dev runtime — exactly the divergence this watch exists to close.
 */

import { describe, expect, test } from "bun:test";
import { extensionDirs } from "./runtime.ts";

describe("extensionDirs", () => {
	test("extension files contribute their parent dirs, deduplicated", () => {
		expect(extensionDirs(["extensions/a.ts", "extensions/b.ts", "shared/c.ts"])).toEqual([
			"extensions",
			"shared",
		]);
	});

	test("a configured native dir is in the watch set", () => {
		expect(extensionDirs(["extensions/clock.ts"], "/p/native")).toEqual([
			"extensions",
			"/p/native",
		]);
	});

	test("no native dir means no native watch", () => {
		expect(extensionDirs(["extensions/clock.ts"], undefined)).toEqual(["extensions"]);
		expect(extensionDirs(undefined, undefined)).toEqual([]);
	});
});
