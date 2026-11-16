/**
 * `crust:crash-reporter` proofs that never install a real handler. Every test injects a fake native half and a fake guard state, so nothing here can fault or leave a signal handler behind in the test process.
 * What is proven is the contract: a guard that was never started is named rather than answered with an empty list, the readers report what the guard wrote, and clearing is refused from the page so it cannot erase its own evidence.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crashLogPath, crashRecordPath, lastCrashPath } from "@/platform/darwin/crash-record";
import {
	type CrashNative,
	crashReporterPlugin,
	createCrashReporterPlugin,
} from "@/plugins/crash-reporter";
import { isNotImplemented } from "@/plugins/define";

const temps: string[] = [];

afterEach(async () => {
	while (temps.length > 0) await rm(temps.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-crash-reporter-"));
	temps.push(dir);
	return dir;
}

/** A guard that says it is running, without a process behind it. */
const RUNNING = { running: () => true };

/** Records every arm and disarm, so the test can see the path the plugin chose. */
function fakeNative(): { native: CrashNative; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		native: {
			arm: (record) => {
				calls.push(`arm ${record}`);
				return { armed: true, status: 0, reason: "armed" };
			},
			disarm: () => {
				calls.push("disarm");
				return { armed: false, status: 0, reason: "disarmed" };
			},
		},
	};
}

const crash = {
	signal: "SIGSEGV",
	code: 1,
	address: "0x0",
	at: "2026-11-16T00:00:00.000Z",
	handler: "SIGSEGV",
	exitCode: 70,
};

describe("crash-reporter plugin", () => {
	test("the default registration names the guard that was never started", () => {
		expect(crashReporterPlugin.name).toBe("crash-reporter");
		const results = [
			crashReporterPlugin.commands.last(),
			crashReporterPlugin.commands.list(),
			crashReporterPlugin.commands.clear(),
			crashReporterPlugin.commands.install(),
			crashReporterPlugin.commands.uninstall(),
		];
		for (const result of results) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) {
				expect(result.message).toBe("crash-reporter: the helper process is not running");
				expect(result.requires).toBe("startCrashGuard()");
			}
		}
	});

	test("a running guard with nothing recorded answers null and an empty list", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		expect(plugin.commands.last()).toEqual({ crash: null, root });
		expect(plugin.commands.list()).toEqual({ crashes: [], root });
	});

	test("last and list read what the guard wrote", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		await writeFile(lastCrashPath(root), JSON.stringify(crash), "utf8");
		await writeFile(
			crashLogPath(root),
			`${JSON.stringify(crash)}\n${JSON.stringify({ ...crash, signal: "SIGBUS" })}\n`,
			"utf8",
		);
		expect(plugin.commands.last()).toEqual({ crash, root });
		expect(plugin.commands.list()).toEqual({
			crashes: [crash, { ...crash, signal: "SIGBUS" }],
			root,
		});
		expect(plugin.commands.list({ limit: 1 })).toEqual({
			crashes: [{ ...crash, signal: "SIGBUS" }],
			root,
		});
	});

	test("clear is refused from the page, and the evidence stays readable", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		await writeFile(lastCrashPath(root), JSON.stringify(crash), "utf8");
		await writeFile(crashLogPath(root), `${JSON.stringify(crash)}\n`, "utf8");
		const refused = plugin.commands.clear();
		expect(refused).toMatchObject({ ok: false, code: "page-cannot-clear", root });
		if (!isNotImplemented(refused) && !refused.ok) {
			expect(refused.message).toContain("clearCrashes");
			expect(refused.message).toContain(root);
		}
		// The point of the refusal: the page cannot erase what it crashed with.
		expect(plugin.commands.last()).toEqual({ crash, root });
		expect(plugin.commands.list()).toEqual({ crashes: [crash], root });
	});

	test("install arms the record path and uninstall disarms", async () => {
		const root = await tempDir();
		const { native, calls } = fakeNative();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING, native });
		expect(plugin.commands.install()).toEqual({
			armed: true,
			reason: "armed",
			record: crashRecordPath(root),
			root,
		});
		expect(plugin.commands.uninstall()).toEqual({ armed: false, reason: "disarmed" });
		expect(calls).toEqual([`arm ${crashRecordPath(root)}`, "disarm"]);
	});

	test("a running guard without the native half refuses install, naming the handler", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		for (const result of [plugin.commands.install(), plugin.commands.uninstall()]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("armCrashHandlers()");
		}
	});

	test("a guard that stopped running is refused again, not answered stale", async () => {
		const root = await tempDir();
		const guard = { running: () => false };
		const plugin = createCrashReporterPlugin({ root, guard });
		expect(isNotImplemented(plugin.commands.last())).toBe(true);
	});
});
