/**
 * The Windows opener, driven through the fake shim. What is proved is the mapping the plugin reads:
 * a missing path is `not-found` before any send, a `SE_ERR_*` refusal carries the C half's reason,
 * and no attached platform is a sentence naming Win32 rather than AppKit.
 *
 * `import.meta.dir` is the existing path every success case uses: it is a real directory on the
 * machine running the suite, so `existsSync` is not being faked.
 */
import { describe, expect, test } from "bun:test";
import { createOpenerPlugin } from "@/plugins/opener";
import { NO_WINDOWS_SHIM } from "./active-shim.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { fakeShim } from "./fake-shim.ts";
import { OPENER_STATUS, windowsOpenerAdapter } from "./opener.ts";

/** An adapter over a fake shim, with every answer stated by the test. */
function adapter(options: FakeOptions = {}) {
	return windowsOpenerAdapter(() => fakeShim(options));
}

describe("opener on Windows", () => {
	test("openPath hands an existing path to the shell", () => {
		const native = adapter();
		expect(native.openPath(import.meta.dir)).toEqual({
			status: OPENER_STATUS.opened,
			reason: "",
		});
	});

	test("a path that is not on disk is refused before any send", () => {
		expect(adapter().openPath("/definitely/not/here")).toMatchObject({
			status: OPENER_STATUS.notFound,
		});
	});

	test("openUrl hands the URL over unchanged", () => {
		expect(adapter().openUrl("https://crust.dev")).toEqual({
			status: OPENER_STATUS.opened,
			reason: "",
		});
	});

	test("a SE_ERR_* refusal carries the reason the C half recorded", () => {
		const native = adapter({
			openerResult: 0,
			openerReason: "ShellExecuteW answered a SE_ERR_* code at or below 32",
		});
		expect(native.openUrl("https://crust.dev")).toEqual({
			status: OPENER_STATUS.refused,
			reason: "ShellExecuteW answered a SE_ERR_* code at or below 32",
		});
	});

	test("revealItem uses the shell's select verb", () => {
		expect(adapter().revealItem(import.meta.dir)).toMatchObject({
			status: OPENER_STATUS.opened,
		});
	});

	test("no attached platform refuses with one sentence, not a crash", () => {
		const native = windowsOpenerAdapter(() => undefined);
		expect(native.openUrl("https://crust.dev")).toEqual({
			status: OPENER_STATUS.refused,
			reason: NO_WINDOWS_SHIM,
		});
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("a success is ok with the absolute path", () => {
		const plugin = createOpenerPlugin(adapter());
		expect(plugin.commands.openUrl({ url: "https://crust.dev" })).resolves.toEqual({
			ok: true,
			url: "https://crust.dev",
		});
	});

	test("a missing path is not-found, the bridge's own code", async () => {
		const answer = await createOpenerPlugin(adapter()).commands.openPath({ path: "/nope/x" });
		expect(answer).toMatchObject({ ok: false, code: "not-found" });
	});

	test("a shell refusal is a handler-error carrying the reason", async () => {
		const plugin = createOpenerPlugin(adapter({ openerResult: 0, openerReason: "no handler" }));
		const answer = await plugin.commands.openUrl({ url: "https://crust.dev" });
		expect(answer).toMatchObject({ ok: false, code: "handler-error", message: "no handler" });
	});

	test("no platform names Win32, never NSWorkspace", async () => {
		const plugin = createOpenerPlugin(windowsOpenerAdapter(() => undefined));
		const answer = await plugin.commands.openUrl({ url: "https://crust.dev" });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = "message" in answer ? answer.message : "";
		expect(message).toBe(NO_WINDOWS_SHIM);
		expect(message).not.toContain("NSWorkspace");
	});
});
