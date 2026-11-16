/**
 * `crust:downloads` proofs that need no WebKit. Every test injects the fake adapter, so nothing here
 * downloads a file or builds an Objective-C class.
 * What is proven is the contract: the default registration is the honest one, the destination stays
 * inside the app's data root, and a native finish or failure reaches the page as an event.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { isNotImplemented, type NotImplemented } from "@/plugins/define.ts";
import {
	DOWNLOADS_DIRECTORY,
	DOWNLOADS_ROOT,
	fakeDownloads,
	recorder,
} from "@/plugins/downloads-fake.ts";
import { createDownloadsPlugin, downloadsPlugin } from "@/plugins/downloads.ts";

const ROOT = DOWNLOADS_ROOT;

/** A result the test knows landed: a `NotImplemented` becomes a failure with its own message. */
function ok<T>(value: T | NotImplemented): T {
	if (isNotImplemented(value)) throw new Error(`not-implemented: ${value.message}`);
	return value;
}

describe("downloads plugin", () => {
	test("not-implemented without an adapter, naming WKDownloadDelegate", async () => {
		const plugin = createDownloadsPlugin();
		for (const result of [
			await plugin.commands.list({}, recorder().ctx),
			await plugin.commands.start({ url: "https://crust.dev/a.zip" }, recorder().ctx),
			await plugin.commands.cancel({ id: "dl-1" }, recorder().ctx),
			await plugin.commands.directory({}, recorder().ctx),
			await plugin.commands.setDirectory({ path: ROOT }, recorder().ctx),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("WKDownloadDelegate");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(downloadsPlugin.name).toBe("downloads");
		expect(typeof downloadsPlugin.commands.start).toBe("function");
	});

	test("a start records the entry, tells the page, and defaults under the data root", async () => {
		const { adapter, started, directories } = fakeDownloads();
		const { events, ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });

		const result = ok(await plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx));
		expect(result.download).toEqual({
			id: "dl-1",
			url: "https://crust.dev/a.zip",
			path: "",
			status: "downloading",
			progress: 0,
		});
		expect(started).toEqual(["dl-1 https://crust.dev/a.zip"]);
		expect(directories[0]).toBe(DOWNLOADS_DIRECTORY);
		expect(events).toEqual([{ event: "download:started", data: result.download }]);
	});

	test("a bad url is bad-request and the adapter is never asked", async () => {
		const { adapter, started } = fakeDownloads();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		await expect(plugin.commands.start({ url: "" }, recorder().ctx)).rejects.toMatchObject({
			code: "bad-request",
		});
		await expect(
			plugin.commands.start({ url: "crust.dev/a.zip" }, recorder().ctx),
		).rejects.toMatchObject({ code: "bad-request" });
		expect(started).toEqual([]);
	});

	test("a refused send is handler-error, never a phantom entry", async () => {
		const { adapter } = fakeDownloads({ start: false });
		const { ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		await expect(
			plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx),
		).rejects.toMatchObject({ code: "handler-error" });
		expect(ok(await plugin.commands.list({}, ctx)).downloads).toEqual([]);
	});

	test("a finished event sets the path and emits, and a failed one carries its reason", async () => {
		const { adapter, emit } = fakeDownloads();
		const { events, ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		ok(await plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx));
		ok(await plugin.commands.start({ url: "https://crust.dev/b.zip" }, ctx));

		emit({ kind: "finished", id: "dl-1", text: join(DOWNLOADS_DIRECTORY, "a.zip") });
		emit({ kind: "failed", id: "dl-2", text: "The network connection was lost." });

		const listed = ok(await plugin.commands.list({}, ctx));
		expect(listed.downloads[0]).toMatchObject({ status: "finished", progress: 1 });
		expect(listed.downloads[0]?.path).toBe(join(DOWNLOADS_DIRECTORY, "a.zip"));
		expect(listed.downloads[1]).toMatchObject({
			status: "failed",
			error: "The network connection was lost.",
		});
		expect(events.map((entry) => entry.event)).toEqual([
			"download:started",
			"download:started",
			"download:finished",
			"download:failed",
		]);
	});

	test("list emits progress once per change, not once per call", async () => {
		const { adapter } = fakeDownloads({ progress: 0.5 });
		const { events, ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		ok(await plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx));

		ok(await plugin.commands.list({}, ctx));
		ok(await plugin.commands.list({}, ctx));
		const progress = events.filter((entry) => entry.event === "download:progress");
		expect(progress).toHaveLength(1);
		expect(progress[0]?.data).toMatchObject({ id: "dl-1", progress: 0.5 });
	});

	test("cancel refuses an unknown id and a finished one, and cancels a live one", async () => {
		const { adapter, cancelled, emit } = fakeDownloads();
		const { ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });

		await expect(plugin.commands.cancel({ id: "dl-9" }, ctx)).rejects.toMatchObject({
			code: "bad-request",
		});
		ok(await plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx));
		expect(ok(await plugin.commands.cancel({ id: "dl-1" }, ctx))).toEqual({
			ok: true,
			id: "dl-1",
			cancelled: true,
		});
		expect(cancelled).toEqual(["dl-1"]);
		await expect(plugin.commands.cancel({ id: "dl-1" }, ctx)).rejects.toMatchObject({
			code: "bad-request",
		});
		emit({ kind: "finished", id: "dl-1", text: "/tmp/gone.zip" });
		expect(ok(await plugin.commands.list({}, ctx)).downloads[0]?.status).toBe("cancelled");
	});

	test("a cancel WebKit refuses is handler-error", async () => {
		const { adapter } = fakeDownloads({ cancel: false });
		const { ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		ok(await plugin.commands.start({ url: "https://crust.dev/a.zip" }, ctx));
		await expect(plugin.commands.cancel({ id: "dl-1" }, ctx)).rejects.toMatchObject({
			code: "handler-error",
		});
	});

	test("setDirectory stays inside the data root and retargets the adapter", async () => {
		const { adapter, directories } = fakeDownloads();
		const { ctx } = recorder();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });

		const inside = join(ROOT, "files");
		expect(ok(await plugin.commands.setDirectory({ path: inside }, ctx))).toEqual({
			ok: true,
			directory: resolve(inside),
		});
		expect(directories).toContain(resolve(inside));
		expect(ok(await plugin.commands.directory({}, ctx))).toEqual({
			ok: true,
			directory: resolve(inside),
		});

		await expect(
			plugin.commands.setDirectory({ path: join(ROOT, "..", "elsewhere") }, ctx),
		).rejects.toMatchObject({ code: "bad-request" });
		await expect(plugin.commands.setDirectory({ path: "relative" }, ctx)).rejects.toMatchObject(
			{
				code: "bad-request",
			},
		);
	});

	test("a sibling whose name merely starts the root is outside it", async () => {
		const { adapter } = fakeDownloads();
		const plugin = createDownloadsPlugin(adapter, { root: ROOT });
		await expect(
			plugin.commands.setDirectory({ path: `${ROOT}-other` }, recorder().ctx),
		).rejects.toMatchObject({ code: "bad-request" });
	});
});
