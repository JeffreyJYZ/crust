/**
 * `crust/plugin` is the only entry an app has for mounting a plugin, so a plugin that exists but is not
 * re-exported by a barrel is unreachable — and unreachable reads as "the framework does not have it".
 * `perf` shipped in 0.2.14 with a working plugin, a working overlay and no export, which is the same
 * failure as a `src/` import that escapes the package: the tree is green and the product is missing a
 * surface.
 *
 * So this asserts behaviour rather than a name: import the real entry, mount the plugin a consumer would
 * mount, and require that a command answers instead of refusing.
 */

import { describe, expect, test } from "bun:test";

import * as pluginEntry from "./index";
import { Collector } from "@/perf/collector";
import { createPerfCommands, createPerfPlugin, PERF_REQUIRES } from "./perf";

describe("the published plugin entry", () => {
	test("exports every plugin an app is meant to mount", () => {
		// A name list, not a shape check: a missing export is the defect, and `typeof undefined` cannot
		// say which name is absent.
		const missing = ["createPerfPlugin", "createWindowPlugin", "createStorePlugin"].filter(
			(name) => typeof (pluginEntry as Record<string, unknown>)[name] !== "function",
		);
		expect(missing).toEqual([]);
	});

	test("a mounted perf plugin answers sample() instead of refusing", async () => {
		// A fresh `Collector` and a fresh plugin, so this test does not depend on, or disturb, the
		// process-wide singleton another test may already have mounted.
		const collector = new Collector();
		const plugin = createPerfPlugin(collector);
		const answer = plugin.commands.sample();

		// The refusal is the failure this test exists to catch: it means the plugin was never mounted.
		expect(answer).not.toHaveProperty("code", "not-implemented");
		expect(answer).not.toHaveProperty("requires", PERF_REQUIRES);
		// Frame statistics come from a page, so an unmounted page half reports null rather than zeros.
		expect(answer).toHaveProperty("frame", null);
		expect(answer).toHaveProperty("runtime");
	});

	test("an unmounted collector refuses by name so the refusal stays honest", () => {
		// `createPerfCommands` over a collector nobody mounted is the state a page hits when the app
		// forgot to mount it; it must name the requirement rather than answer empty numbers.
		const commands = createPerfCommands(new Collector());
		const answer = commands.sample();
		expect(answer).toHaveProperty("code", "not-implemented");
		expect(answer).toHaveProperty("requires", PERF_REQUIRES);
	});
});
