/**
 * The in-process `app.invoke` path must speak the bridge's error language: a returned
 * `NotImplemented` is a refusal, never data, and any thrown error carries a machine `code`.
 * Both public spellings stay — this test is why neither is removed.
 */

import { describe, expect, test } from "bun:test";

import { App } from "@/app.ts";
import { NotImplementedError, notImplemented } from "@/plugins/define.ts";

describe("app.invoke error shapes", () => {
	test("a returned notImplemented refuses instead of resolving as data", async () => {
		const app = new App();
		app.command("screen.list", () => notImplemented("no NSScreen", "NSScreen"));

		await expect(app.invoke("screen.list")).rejects.toMatchObject({
			code: "not-implemented",
			message: "no NSScreen",
			requires: "NSScreen",
		});
	});

	test("a thrown NotImplementedError keeps its code and requires", async () => {
		const app = new App();
		app.command("power.subscribe", () => {
			throw new NotImplementedError("no distributed centre", "NSDistributedNotificationCenter");
		});

		await expect(app.invoke("power.subscribe")).rejects.toMatchObject({
			code: "not-implemented",
			message: "no distributed centre",
			requires: "NSDistributedNotificationCenter",
		});
	});

	test("a plain thrown error gains the code the bridge gives it", async () => {
		const app = new App();
		app.command("boom", () => {
			throw new Error("handler blew up");
		});

		await expect(app.invoke("boom")).rejects.toMatchObject({
			code: "handler-error",
			message: "handler blew up",
		});
	});

	test("an ordinary result still resolves unchanged", async () => {
		const app = new App();
		app.command("echo", () => ({ ok: true }));
		expect(await app.invoke("echo")).toEqual({ ok: true });
	});
});
