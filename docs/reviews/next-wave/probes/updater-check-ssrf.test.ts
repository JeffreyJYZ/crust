/**
 * Probe (Lane 2): `updater.check` fetches a page-supplied endpoint with no URL policy.
 *
 * `download` runs its URL through `downloadUrlFailure`, which refuses everything
 * but https (and file with an opt-in). `check` calls `adapter.fetchJson(endpoint)`
 * directly, so a page can make the app fetch http, loopback, or file URLs. The
 * app's fetch is not subject to CORS, so the page also reads a response it could
 * not fetch itself.
 *
 * Run: bun test docs/reviews/next-wave/probes/updater-check-ssrf.test.ts
 * Expected: RED — the http endpoint is accepted instead of refused.
 */
import { afterEach, describe, expect, test } from "bun:test";

import { createUpdaterPlugin } from "../../../../src/plugins/updater.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
	while (servers.length > 0) servers.pop()?.stop(true);
});

describe("updater.check endpoint URL policy", () => {
	test("an http loopback endpoint is refused the way download refuses it", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => Response.json({
				version: "9.9.9",
				url: "https://example.invalid/app.zip",
				sha256: "a".repeat(64),
			}),
		});
		servers.push(server);
		const plugin = createUpdaterPlugin();
		const check = (plugin.commands as any).check;
		const result = await check({
			endpoint: `http://127.0.0.1:${server.port}/manifest.json`,
			currentVersion: "1.0.0",
		});
		// expected: a refusal naming the scheme; actual: a successful check.
		expect(result).toMatchObject({ available: false });
	});
});
