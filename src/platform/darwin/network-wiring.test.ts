/**
 * `crust-net` used to be dead in a built app: the runtime built the plugin with no configuration, so
 * `install` refused before it reached WebKit, and the one configuration windows use was never handed
 * over. This file pins the wiring and, on macOS, the ordering — the scheme is claimed on the shared
 * configuration before the first webview, and the plugin's later install reuses that registration
 * instead of asking WebKit for a second handler (which raises rather than returning false).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NETWORK_SCHEME } from "@/plugins/network-types";
import { darwinNetworkAdapter } from "./network.ts";
import { installNetwork, primeNetwork } from "./network-registration.ts";
import { webviewConfiguration } from "./webview-configuration.ts";

const read = (file: string): string => readFileSync(join(import.meta.dir, file), "utf8");
const notDarwin = process.platform !== "darwin";

describe("the macOS runtime wires the interceptor", () => {
	test("the runtime passes the window configuration to the network plugin", () => {
		const runtime = read("../../runtime-plugins.ts");
		expect(runtime).toContain("darwinNetworkPlugin({ configuration: darwin.webviewConfiguration })");
		expect(runtime).not.toMatch(/^\s*darwinNetworkPlugin\(\),$/m);
	});

	test("the shared configuration claims the scheme at creation, before any webview", () => {
		const source = read("webview-configuration.ts");
		const prime = source.indexOf("primeNetwork(configuration, NETWORK_SCHEME)");
		const done = source.lastIndexOf("return configuration;");
		expect(prime).toBeGreaterThan(-1);
		expect(prime).toBeLessThan(done);
	});

	test("an adapter with no configuration still refuses instead of guessing one", () => {
		const landed = darwinNetworkAdapter().install(NETWORK_SCHEME, () => ({ action: "block" }));
		expect(landed.ok).toBe(false);
		expect(landed.reason).toContain("WKWebViewConfiguration");
	});

	test.skipIf(notDarwin)("registering twice on the same configuration is a no-op, not an abort", () => {
		const configuration = webviewConfiguration();
		expect(configuration).toBeGreaterThan(0);
		expect(primeNetwork(configuration, NETWORK_SCHEME)).toEqual({
			ok: true,
			reason: "registered",
		});
		expect(
			installNetwork(configuration, NETWORK_SCHEME, () => ({ action: "block" })),
		).toEqual({ ok: true, reason: "registered" });
	});

	test("a null configuration is refused by name", () => {
		expect(primeNetwork(0, NETWORK_SCHEME).reason).toContain("WKWebViewConfiguration");
	});
});
