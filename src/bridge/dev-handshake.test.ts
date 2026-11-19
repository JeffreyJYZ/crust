/**
 * The dev handshake file: it carries a document-token bearer credential, so its mode and its
 * contents are part of the security posture, not implementation details. Written into a temp
 * project dir so the repo's own `.crust/` is never touched.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustConfig } from "../config/index.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "../vite.ts";
import { startApp } from "../runtime.ts";

const config: CrustConfig = {
	app: { id: "land.jyz.handshake-test", name: "handshake test", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
	// The handshake only exists for a dev server, so this is what makes it write.
	dev: { url: "http://localhost:5173" },
};

afterEach(() => {
	delete process.env[BRIDGE_URL_VAR];
	delete process.env[BRIDGE_TOKEN_VAR];
});

describe("the dev handshake", () => {
	test("dev.json is 0600 and carries a non-seeding document token, not the seed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-handshake-"));
		try {
			const bridge = await startApp({
				config,
				configPath: join(dir, "crust.config.ts"),
				attachPlatform: false,
				entryModule: async () => {},
			});
			try {
				const file = join(dir, ".crust", "dev.json");
				const mode = statSync(file).mode & 0o777;
				expect(mode).toBe(0o600);
				const written = JSON.parse(readFileSync(file, "utf8")) as {
					url: string;
					token: string;
				};
				expect(written.url).toBe(bridge.url);
				expect(written.token).not.toBe(bridge.token);

				// The token is a real credential: the document route serves it (200, no mint).
				const served = await fetch(`${bridge.url}/?token=${written.token}`, {
					redirect: "manual",
				});
				expect(served.status).toBe(200);

				// It cannot seed: asking it for another label gets the document, not a mint.
				const tried = await fetch(`${bridge.url}/?token=${written.token}&window=admin`, {
					redirect: "manual",
				});
				expect(tried.status).toBe(200);
				expect(tried.headers.get("location")).toBeNull();
			} finally {
				await bridge.stop();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
