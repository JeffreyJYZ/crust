/**
 * Probe (Lane 2): capabilities are keyed on a request-supplied `window` label.
 *
 * A page on Linux/Windows/Vite holds the bearer token in its own world, so it can
 * POST its own invoke body with any `window` it likes. The bridge has no binding
 * between the token and the label it served the document with, so the label is
 * decoration and every capability grant is bypassable.
 *
 * Run: bun test docs/reviews/next-wave/probes/capability-spoof.test.ts
 * Expected: RED — the second test fails because the spoofed label is granted.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
	headers,
	invoke,
	readJson,
	start,
	stopAll,
	testPlugin,
} from "../../../../src/bridge/server/fixtures.ts";
import type { SecurityConfig } from "../../../../src/config/types.ts";

afterEach(stopAll);

const CAPABILITIES: NonNullable<SecurityConfig["capabilities"]> = [
	{ name: "safe", actions: ["test:echo"] },
	{ name: "secret", actions: ["test:secret"] },
];

function security(): SecurityConfig {
	return {
		capabilities: CAPABILITIES,
		grants: { main: ["safe"], admin: ["secret"] },
	};
}

describe("capability label is taken from the request body", () => {
	test("the real label cannot reach an admin command", async () => {
		const bridge = start({ handlers: [testPlugin], security: security() });
		const response = await invoke(bridge, headers(bridge, {
			authorization: `Bearer ${bridge.token}`,
		}), { plugin: "test", command: "secret", window: "main" });
		expect(response.status).toBe(403);
	});

	test("a page that claims the admin label reaches it with the same token", async () => {
		const bridge = start({ handlers: [testPlugin], security: security() });
		const h = headers(bridge, { authorization: `Bearer ${bridge.token}` });
		const asMain = await invoke(bridge, h, {
			plugin: "test", command: "echo", args: 1, window: "main",
		});
		expect(asMain.status).toBe(200);
		const spoofed = await invoke(bridge, h, {
			plugin: "test", command: "secret", window: "admin",
		});
		// The secure answer is a refusal: the token was issued to a `main` document, so a
		// body that claims `admin` must not inherit the admin capability. It is red today
		// because the bridge has no token-to-label binding.
		expect(spoofed.status).toBe(403);
		expect((await readJson(spoofed)).error.code).toBe("forbidden");
	});
});
