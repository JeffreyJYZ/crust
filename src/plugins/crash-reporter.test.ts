/**
 * `crust:crash-reporter` proofs that never install a real handler. Every test injects a fake native half and a fake guard state, so nothing here can fault or leave a signal handler behind in the test process.
 * What is proven is the contract: a guard that was never started is named rather than answered with an empty list, the readers report what the guard wrote, a guard-less page cannot report either, and clearing is refused from the page so it cannot erase its own evidence. The page's own reporting half is proven in `crash-reporter-page.test.ts`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

/** A guard-written record: the guard's own five fields, plus the half that wrote it. */
const crash = {
	type: "signal" as const,
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
			crashReporterPlugin.commands.report({ message: "boom" }),
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

	test("a record written before `type` existed reads as the guard's own", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		const { type: _dropped, ...legacy } = crash;
		await writeFile(lastCrashPath(root), JSON.stringify(legacy), "utf8");
		await writeFile(crashLogPath(root), `${JSON.stringify(legacy)}\n`, "utf8");
		// The page half wrote nothing before this field existed, so the guard gets the credit.
		expect(plugin.commands.last()).toEqual({ crash, root });
		expect(plugin.commands.list()).toEqual({ crashes: [crash], root });
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
		expect(plugin.commands.uninstall()).toEqual({
			armed: false,
			status: 0,
			reason: "disarmed",
		});
		expect(calls).toEqual([`arm ${crashRecordPath(root)}`, "disarm"]);
	});

	test("a failed disarm reports the native armed flag and status, not a restored default", async () => {
		const root = await tempDir();
		const native: CrashNative = {
			arm: () => ({ armed: true, status: 0, reason: "armed" }),
			disarm: () => ({ armed: true, status: 3, reason: "sigaction refused the default" }),
		};
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING, native });
		expect(plugin.commands.uninstall()).toEqual({
			armed: true,
			status: 3,
			reason: "sigaction refused the default",
		});
	});

	test("a running guard without the native half refuses install, naming the handler", async () => {
		const root = await tempDir();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING });
		for (const result of [plugin.commands.install(), plugin.commands.uninstall()]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("armCrashHandlers()");
		}
	});

	test("install still arms the record in the data root after configure repoints the log", async () => {
		const root = await tempDir();
		const sub = join(root, "reports");
		await mkdir(sub, { recursive: true });
		const { native, calls } = fakeNative();
		const plugin = createCrashReporterPlugin({ root, guard: RUNNING, native });
		plugin.commands.configure({ dir: sub });
		plugin.commands.install();
		// The guard reads `crash-record.bin` from the data root, so a moved log must not move it.
		expect(calls).toEqual([`arm ${crashRecordPath(root)}`]);
	});

	test("a guard that stopped running is refused again, not answered stale", async () => {
		const root = await tempDir();
		const guard = { running: () => false };
		const plugin = createCrashReporterPlugin({ root, guard });
		expect(isNotImplemented(plugin.commands.last())).toBe(true);
		expect(isNotImplemented(plugin.commands.report({ message: "boom" }))).toBe(true);
	});
});
