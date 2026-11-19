/**
 * Every mint used to add a UUID to `state.labels` and nothing ever removed one: a
 * create/close cycle grew the map for the bridge's whole life, and a credential
 * copied out of a closed window's history stayed valid forever. The issued-document
 * set is now bounded; the oldest tokens are revoked when the cap is reached.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { MAX_DOCUMENT_TOKENS } from "./document-tokens.ts";
import { start, stopAll } from "./fixtures.ts";

afterEach(stopAll);

describe("issued document tokens are bounded", () => {
	test("the cap is small enough to exercise but large enough to be useful", () => {
		expect(MAX_DOCUMENT_TOKENS).toBeGreaterThan(8);
		expect(MAX_DOCUMENT_TOKENS).toBeLessThan(512);
	});

	test("the oldest document token is revoked once the cap is exceeded", async () => {
		const bridge = start();
		const tokens: string[] = [];
		for (let i = 0; i <= MAX_DOCUMENT_TOKENS; i += 1) {
			const served = await fetch(`${bridge.url}/?token=${bridge.token}`, {
				redirect: "manual",
			});
			const location = served.headers.get("location");
			if (location === null) throw new Error("the document route did not mint a token");
			const token = new URL(location, bridge.url).searchParams.get("token");
			if (token === null) throw new Error("the minted document carried no token");
			tokens.push(token);
		}

		const oldest = await fetch(`${bridge.url}/?token=${tokens[0]}`, { redirect: "manual" });
		expect(oldest.status).toBe(401);

		const newest = await fetch(`${bridge.url}/?token=${tokens.at(-1)}`, { redirect: "manual" });
		expect(newest.status).toBe(200);
	});

	test("the process token is never evicted by the cap", async () => {
		const bridge = start();
		for (let i = 0; i <= MAX_DOCUMENT_TOKENS; i += 1) {
			await fetch(`${bridge.url}/?token=${bridge.token}`, { redirect: "manual" });
		}
		const served = await fetch(`${bridge.url}/?token=${bridge.token}`, { redirect: "manual" });
		expect(served.status).toBe(302);
	});
});
