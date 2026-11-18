/**
 * A compiled app's extension path: the generated entry hands `startApp` a registry it filled with the
 * embedded extensions, and that registration must reach the bridge the page calls — otherwise an
 * extension ships in the binary and answers `unknown-plugin`.
 */

import { describe, expect, test } from "bun:test";

import type { CrustConfig } from "./config/index.ts";
import { currentBridgeToken } from "./bridge/window-identity.ts";
import { defineExtension } from "./extensions/define.ts";
import { extensionRegistry } from "./extensions/registry.ts";
import { startApp } from "./runtime.ts";

const config: CrustConfig = {
	app: { id: "land.jyz.extension-test", name: "extension test", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

describe("startApp", () => {
	test("serves a command from the registry the generated entry filled", async () => {
		const clock = defineExtension({ name: "clock", commands: { now: () => "12:00" } });
		const registry = extensionRegistry().register(clock);

		const bridge = await startApp({
			config,
			attachPlatform: false,
			registry,
			entryModule: async () => {},
		});

		try {
			const response = await fetch(`${bridge.url}/_crust/invoke`, {
				method: "POST",
				headers: {
					origin: bridge.url,
					authorization: `Bearer ${bridge.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ plugin: "clock", command: "now", args: {} }),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true, result: "12:00" });
		} finally {
			await bridge.stop();
			// A stopped app must leave no credential behind. This is process-wide state that
			// `window.create` reads, so a token left here rides on the *next* window's document —
			// measured: without this clear, `window-adapter.test.ts` failed only when this file
			// shared the process, because its relative URL grew `&token=<this run's token>`.
			expect(currentBridgeToken()).toBeUndefined();
		}
	});
});
