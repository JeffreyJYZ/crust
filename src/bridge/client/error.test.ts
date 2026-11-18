/**
 * The page-facing error: importable from the package root and checkable across the bridge.
 * `instanceof` cannot cross a realm, so the guard is structural — the name the injected client
 * stamps plus the fields its wire contract guarantees.
 *
 * The three `@ts-expect-error` directives are the type-level half: if the exported type ever lost
 * its fields, an unused directive makes `bun check` fail on this file.
 */

import { describe, expect, test } from "bun:test";

import { isCrustInvokeError, type CrustInvokeError } from "@/index.ts";
import { definePlugin, notImplemented } from "@/plugins/define.ts";
import { startBridge } from "../server";
import { installPage } from "./fixtures.ts";

function describeError(error: CrustInvokeError): string {
	return `${error.code}:${error.status}`;
}

function typeChecks(error: unknown): void {
	if (!isCrustInvokeError(error)) return;
	const code: string = error.code;
	const status: number = error.status;
	const requires: string | undefined = error.requires;
	// @ts-expect-error code is a string, never a number
	const wrong: number = error.code;
	void [describeError(error), code, status, requires, wrong];
}

typeChecks(null);

describe("CrustInvokeError", () => {
	test("the guard recognises the error the injected client actually throws", async () => {
		const bridge = startBridge({
			handlers: [
				definePlugin({
					name: "screen",
					commands: { list: () => notImplemented("no NSScreen", "NSScreen") },
				}),
			],
		});
		try {
			const { api } = installPage(bridge, { stream: false });
			let caught: unknown;
			try {
				await api.invoke("screen", "list");
			} catch (error) {
				caught = error;
			}
			expect(isCrustInvokeError(caught)).toBe(true);
			if (isCrustInvokeError(caught)) {
				expect(caught.code).toBe("not-implemented");
				expect(caught.status).toBe(501);
				expect(caught.requires).toBe("NSScreen");
				expect(caught.name).toBe("CrustInvokeError");
			}
		} finally {
			await bridge.stop();
		}
	});

	test("the guard refuses plain errors and lookalikes with no status", () => {
		expect(isCrustInvokeError(new Error("plain"))).toBe(false);
		expect(isCrustInvokeError(null)).toBe(false);
		expect(isCrustInvokeError({ code: "boom", message: "no status" })).toBe(false);
		expect(isCrustInvokeError("handler-error")).toBe(false);
	});
});
