/**
 * Handshake publication is where a mint miss becomes either a loud failure or a silent,
 * invoker-less page. These pin both: no document token means no dev run, and the token that is
 * published is the minted document token, never the seed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, stopAll } from "./bridge/server/fixtures.ts";
import { devHandshakePath } from "./dev-handshake-path.ts";
import { publishDevHandshake } from "./runtime-host.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "./vite.ts";

afterEach(() => {
	delete process.env[BRIDGE_URL_VAR];
	delete process.env[BRIDGE_TOKEN_VAR];
	delete process.env.CRUST_DEV_FILE;
	return stopAll();
});

describe("publishing the dev handshake", () => {
	test("a mint that cannot happen fails the run and writes nothing", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-handshake-fail-"));
		try {
			expect(() =>
				publishDevHandshake(dir, {
					url: "http://127.0.0.1:1",
					mintPageToken: () => {
						throw new Error("bridge is gone");
					},
				}),
			).toThrow(/window\.crust/);
			expect(existsSync(devHandshakePath(dir))).toBe(false);
			expect(existsSync(join(dir, ".crust"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the published token is the minted document token, not the seed", () => {
		const bridge = start();
		const dir = mkdtempSync(join(tmpdir(), "crust-handshake-ok-"));
		try {
			publishDevHandshake(dir, bridge);
			const written = JSON.parse(readFileSync(devHandshakePath(dir), "utf8")) as {
				url: string;
				token: string;
			};
			expect(written.url).toBe(bridge.url);
			expect(written.token).not.toBe(bridge.token);
			expect(process.env[BRIDGE_URL_VAR]).toBe(bridge.url);
			expect(process.env[BRIDGE_TOKEN_VAR]).toBe(written.token);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
