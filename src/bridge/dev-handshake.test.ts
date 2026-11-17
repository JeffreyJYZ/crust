/**
 * The dev handshake file: it carries the per-launch bearer token, so its mode is part of the
 * security posture, not an implementation detail. Written into a temp project dir so the repo's own
 * `.crust/` is never touched.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustConfig } from "../config/index.ts";
import { startApp } from "../runtime.ts";

const config: CrustConfig = {
	app: { id: "land.jyz.handshake-test", name: "handshake test", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
	// The handshake only exists for a dev server, so this is what makes it write.
	dev: { url: "http://localhost:5173" },
};

describe("the dev handshake", () => {
	test("dev.json is 0600 and carries the bridge's own url and token", async () => {
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
				const written = JSON.parse(readFileSync(file, "utf8"));
				expect(written).toEqual({ url: bridge.url, token: bridge.token });
			} finally {
				await bridge.stop();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
