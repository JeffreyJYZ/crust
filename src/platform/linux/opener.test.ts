/**
 * The Linux opener, driven through a fake symbol table. What is proved is the mapping the plugin
 * reads: a missing path is `not-found` before any send, a GIO refusal carries the shim's reason, and
 * `revealItem` refuses by name because no Linux desktop has a standard selection call.
 *
 * `import.meta.dir` is the existing path every success case uses, so `existsSync` is not being faked.
 */
import { describe, expect, test } from "bun:test";
import { createOpenerPlugin } from "@/plugins/opener";
import { fakeCoreShim } from "./core-fake.ts";
import { NO_REVEAL, OPENER_STATUS, linuxOpenerAdapter } from "./opener.ts";

/** An adapter over a fake symbol table, with every answer stated by the test. */
function adapter(options = {}) {
	return linuxOpenerAdapter(() => fakeCoreShim(options));
}

describe("opener on Linux", () => {
	test("openPath hands an existing path to GIO as a file URI", () => {
		expect(adapter().openPath(import.meta.dir)).toEqual({
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

	test("a GIO refusal carries the reason the C half recorded", () => {
		const native = adapter({
			openerResult: 0,
			openerReason: "g_app_info_launch_default_for_uri answered FALSE",
		});
		expect(native.openUrl("https://crust.dev")).toEqual({
			status: OPENER_STATUS.refused,
			reason: "g_app_info_launch_default_for_uri answered FALSE",
		});
	});

	test("revealItem refuses by name, because no Linux desktop can select an item", () => {
		expect(adapter().revealItem(import.meta.dir)).toEqual({
			status: OPENER_STATUS.refused,
			reason: NO_REVEAL,
		});
	});

	test("revealItem still answers not-found for a path that is gone", () => {
		expect(adapter().revealItem("/definitely/not/here")).toMatchObject({
			status: OPENER_STATUS.notFound,
		});
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("a success is ok with the URL", async () => {
		const answer = await createOpenerPlugin(adapter()).commands.openUrl({
			url: "https://crust.dev",
		});
		expect(answer).toEqual({ ok: true, url: "https://crust.dev" });
	});

	test("a missing path is not-found, the bridge's own code", async () => {
		const answer = await createOpenerPlugin(adapter()).commands.openPath({ path: "/nope/x" });
		expect(answer).toMatchObject({ ok: false, code: "not-found" });
	});

	test("a GIO refusal is a handler-error naming the call, never NSWorkspace", async () => {
		const plugin = createOpenerPlugin(adapter({ openerResult: 0 }));
		const answer = await plugin.commands.openUrl({ url: "https://crust.dev" });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = "message" in answer ? answer.message : "";
		expect(message).toContain("g_app_info_launch_default_for_uri");
		expect(message).not.toContain("NSWorkspace");
	});
});
