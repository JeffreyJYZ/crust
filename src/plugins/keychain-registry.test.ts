/**
 * `crust:keychain` has to be registered by the runtime, exported from a barrel, and documented — the
 * three places a plugin silently goes missing. Each case below reads the source that carries it, so a
 * plugin that exists in `src/plugins/` but reaches no page fails here instead of in a user's app.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keychainPlugin, KEYCHAIN_COMMANDS } from "@/plugins/keychain.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("the keychain plugin reaches a page", () => {
	test("the runtime registers it on every platform", () => {
		const runtime = read("src/runtime-plugins.ts");
		// All three arms: darwin's own list, and the platform-less return both call this one builder,
		// so a platform without an adapter still gets the plugin and refuses by name.
		expect(runtime).toContain("platformKeychainPlugin()");
		expect(runtime.split("keychainPlugin").length).toBeGreaterThan(2);
	});

	test("the platform builder picks the half each OS has, and refuses on the rest", () => {
		const builder = read("src/runtime-keychain.ts");
		expect(builder).toContain('process.platform === "win32"');
		expect(builder).toContain("@/platform/windows/keychain");
		expect(builder).toContain("@/platform/darwin/keychain");
		// The fallback is the bare plugin for an unrecognised platform; each command refuses by name.
		expect(builder).toContain("return createKeychainPlugin()");
	});

	test("the split barrel exports it, so an app can register its own", () => {
		expect(read("src/plugins/barrel-system.ts")).toContain("createKeychainPlugin");
	});

	test("the plugin declares exactly the four documented commands", () => {
		expect(Object.keys(keychainPlugin.commands).sort()).toEqual([...KEYCHAIN_COMMANDS].sort());
	});

	test("a guide page and a parity row both exist, and the row says Linux works except `list`", () => {
		const guide = read("site/app/docs/guides/keychain/page.mdx");
		for (const command of KEYCHAIN_COMMANDS) {
			// Every command is named in the guide, so a new one added to the plugin cannot ship with
			// no documentation.
			expect(guide.includes(`\`${command}\``)).toBe(true);
		}
		const parity = read("site/app/docs/reference/parity/page.mdx");
		const row = parity.split("\n").find((line) => line.startsWith("| Secure storage"));
		expect(row).toBeDefined();
		expect(row).toContain("not-implemented");
		expect(row).toContain("libsecret");
	});
});
