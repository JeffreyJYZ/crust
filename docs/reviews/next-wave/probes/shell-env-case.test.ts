/**
 * Probe (Lane 2): the shell env injection blocklist is case-sensitive.
 *
 * Windows environment names are case-insensitive, so `node_options=--require …`
 * reaches Node as NODE_OPTIONS even though `readEnv` only compares exact
 * uppercase names. The fix is to fold the key before the comparison.
 *
 * Run: bun test docs/reviews/next-wave/probes/shell-env-case.test.ts
 * Expected: RED — the lowercase form is accepted.
 */
import { describe, expect, test } from "bun:test";

import { readEnv } from "../../../../src/plugins/shell-env.ts";

describe("shell env injection blocklist", () => {
	test("lowercase spelling of NODE_OPTIONS is refused", () => {
		const result = readEnv({ node_options: "--require /tmp/evil.js" }, true);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("env-not-allowed");
	});

	test("lowercase spelling of a DYLD_ variable is refused", () => {
		const result = readEnv({ dyld_insert_libraries: "/tmp/evil.dylib" }, true);
		expect(result.ok).toBe(false);
	});
});
