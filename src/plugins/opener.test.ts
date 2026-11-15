/**
 * `crust:opener` proofs that need no AppKit. Every test injects a fake adapter, so nothing here opens a file, a URL or a Finder window — a test that launched a browser on a machine someone is using would be a defect, not a proof.
 * What is proven is the contract: the shape of every answer, the mapping from an OS status to a bridge code, and that nothing throws.
 */

import { describe, expect, test } from "bun:test";
import { isAbsolute, resolve } from "node:path";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createOpenerPlugin,
	type OpenerAdapter,
	type OpenerOutcome,
	openerPlugin,
} from "@/plugins/opener.ts";

/** `OPENER_STATUS` in `platform/darwin/opener.ts`, restated because the plugin owns no framework. */
const OPENED = 0;
const NOT_FOUND = 1;
const REFUSED = 2;

interface Recorded {
	adapter: OpenerAdapter;
	seen: string[];
}

/** A fake that answers `answer` to every command and records what it was handed. */
function fake(answer: OpenerOutcome = { status: OPENED, reason: "opened" }): Recorded {
	const seen: string[] = [];
	const record = (text: string): OpenerOutcome => {
		seen.push(text);
		return answer;
	};
	return {
		seen,
		adapter: {
			openPath: (path) => record(path),
			openUrl: (url) => record(url),
			revealItem: (path) => record(path),
		},
	};
}

describe("opener plugin", () => {
	test("not-implemented without an adapter, naming NSWorkspace", async () => {
		const plugin = createOpenerPlugin();
		for (const result of [
			await plugin.commands.openPath({ path: "/tmp" }),
			await plugin.commands.openUrl({ url: "https://crust.dev" }),
			await plugin.commands.revealItem({ path: "/tmp" }),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("NSWorkspace");
		}
	});

	test("the default registration is the adapter-less one", () => {
		expect(openerPlugin.name).toBe("opener");
		expect(typeof openerPlugin.commands.openPath).toBe("function");
	});

	test("an opened path answers ok:true with the absolute path it was handed", async () => {
		const { adapter, seen } = fake();
		const result = await createOpenerPlugin(adapter).commands.openPath({ path: "notes.txt" });
		expect(result).toEqual({ ok: true, path: resolve("notes.txt") });
		expect(seen).toEqual([resolve("notes.txt")]);
	});

	test("an absolute path is passed through unchanged", async () => {
		const { adapter, seen } = fake();
		await createOpenerPlugin(adapter).commands.openPath({ path: "/tmp/crust-note.txt" });
		expect(seen).toEqual(["/tmp/crust-note.txt"]);
		expect(isAbsolute("/tmp/crust-note.txt")).toBe(true);
	});

	test("a missing path is not-found and keeps the adapter's reason", async () => {
		const reason = "no path at /tmp/gone";
		const { adapter } = fake({ status: NOT_FOUND, reason });
		const result = await createOpenerPlugin(adapter).commands.openPath({ path: "/tmp/gone" });
		expect(result).toEqual({ ok: false, code: "not-found", message: reason });
	});

	test("a refused send is handler-error, so a permission wall is never a success", async () => {
		const reason = "NSWorkspace -openURL: answered NO";
		const { adapter } = fake({ status: REFUSED, reason });
		expect(await createOpenerPlugin(adapter).commands.openPath({ path: "/tmp" })).toEqual({
			ok: false,
			code: "handler-error",
			message: reason,
		});
	});

	test("an adapter that throws is a typed failure, never a rejected invoke", async () => {
		const adapter: OpenerAdapter = {
			openPath: () => {
				throw new Error("the opener C unit did not compile");
			},
			openUrl: () => {
				throw new Error("boom");
			},
			revealItem: () => {
				throw new Error("boom");
			},
		};
		const result = await createOpenerPlugin(adapter).commands.openPath({ path: "/tmp" });
		expect(result).toEqual({
			ok: false,
			code: "handler-error",
			message: "the opener C unit did not compile",
		});
	});

	test("a bad argument is bad-request and the adapter is never called", async () => {
		const { adapter, seen } = fake();
		const plugin = createOpenerPlugin(adapter);
		expect(await plugin.commands.openPath({ path: "" })).toEqual({
			ok: false,
			code: "bad-request",
			message: 'opener.openPath: "path" must be a non-empty string',
		});
		expect(await plugin.commands.revealItem({} as { path: string })).toEqual({
			ok: false,
			code: "bad-request",
			message: 'opener.revealItem: "path" must be a non-empty string',
		});
		expect(await plugin.commands.openUrl({ url: 7 } as unknown as { url: string })).toEqual({
			ok: false,
			code: "bad-request",
			message: 'opener.openUrl: "url" must be a non-empty string',
		});
		expect(seen).toEqual([]);
	});

	test("a URL with no scheme is refused before the OS sees it", async () => {
		const { adapter, seen } = fake();
		const result = await createOpenerPlugin(adapter).commands.openUrl({ url: "crust.dev" });
		expect(result).toEqual({
			ok: false,
			code: "bad-request",
			message: 'opener.openUrl: "crust.dev" has no scheme, so it is not a URL',
		});
		expect(seen).toEqual([]);
	});

	test("any scheme reaches the adapter, not only https", async () => {
		const { adapter, seen } = fake();
		const result = await createOpenerPlugin(adapter).commands.openUrl({
			url: "x-apple.systempreferences:com.apple.preference",
		});
		expect(result).toEqual({
			ok: true,
			url: "x-apple.systempreferences:com.apple.preference",
		});
		expect(seen).toEqual(["x-apple.systempreferences:com.apple.preference"]);
	});

	test("a reveal answers revealed:true, which is the only evidence the send ran", async () => {
		const { adapter, seen } = fake({ status: OPENED, reason: "revealed" });
		const result = await createOpenerPlugin(adapter).commands.revealItem({ path: "/tmp" });
		expect(result).toEqual({ ok: true, path: "/tmp", revealed: true });
		expect(seen).toEqual(["/tmp"]);
	});

	test("an async adapter is awaited, not mistaken for an outcome", async () => {
		const adapter: OpenerAdapter = {
			openPath: async () => ({ status: OPENED, reason: "opened" }),
			openUrl: async () => ({ status: REFUSED, reason: "no handler for that scheme" }),
			revealItem: async () => ({ status: NOT_FOUND, reason: "no path at /gone" }),
		};
		const plugin = createOpenerPlugin(adapter);
		expect(await plugin.commands.openPath({ path: "/tmp" })).toEqual({
			ok: true,
			path: "/tmp",
		});
		expect(await plugin.commands.openUrl({ url: "ftp://x" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "no handler for that scheme",
		});
		expect(await plugin.commands.revealItem({ path: "/gone" })).toEqual({
			ok: false,
			code: "not-found",
			message: "no path at /gone",
		});
	});
});
