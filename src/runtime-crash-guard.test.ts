/**
 * The guard's own proofs, run without crashing this machine: every fault happens inside a child the test spawned, and the guard is a separate process the test can watch die.
 * The fault is a real one — a null dereference compiled through `cc()` — because a JS-sent fatal signal does not reach an installed handler here: `process.kill(process.pid, "SIGSEGV")` reaps the child by the default disposition (measured: exit 139, no record), while the same signal delivered from outside the process runs the handler and exits 70. A real fault is also the crash the product exists to record.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CRASH_EXIT_CODE,
	CRASH_RECORD_BYTES,
	crashRecordPath,
	decodeCrashRecord,
	lastCrashPath,
	signalName,
} from "@/platform/darwin/crash-record";
import { type CrashGuard, startCrashGuard } from "@/runtime-crash-guard";
import { listCrashes, readLastCrash } from "@/runtime-crash-store";

const temps: string[] = [];
const guards: CrashGuard[] = [];
const children: Subprocess[] = [];

/** Backstop only. The waited-for event is the process's own `exited` promise. */
const EXIT_BACKSTOP_MS = 15_000;

afterEach(async () => {
	for (const guard of guards.splice(0)) guard.stop();
	for (const child of children.splice(0)) {
		try {
			child.kill();
		} catch {
			// Already gone.
		}
	}
	while (temps.length > 0) await rm(temps.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-crash-guard-"));
	temps.push(dir);
	return dir;
}

/** The darwin crash unit, addressed absolutely: the child is a script in a temp directory. */
const CRASH_MODULE = join(import.meta.dir, "platform/darwin/crash.ts");

/** The fault the child raises: a real null dereference, which the kernel turns into SIGSEGV. */
const BOOM_C = `int boom(void) {\n\tvolatile int *p = (volatile int *)0;\n\treturn *p;\n}\n`;

/**
 * A child that waits for the guard to exist before arming — arming earlier would be undone by the
 * guard's own cleanup — then ends the way `ending` says.
 */
function childSource(boom: string, record: string, go: string, ending: string): string {
	return [
		`import { existsSync } from "node:fs";`,
		`import { cc, FFIType } from "bun:ffi";`,
		`import { armCrashHandlers } from ${JSON.stringify(CRASH_MODULE)};`,
		`const go = ${JSON.stringify(go)};`,
		`const deadline = Date.now() + 5000;`,
		`while (!existsSync(go) && Date.now() < deadline) await Bun.sleep(10);`,
		`const armed = armCrashHandlers(${JSON.stringify(record)});`,
		`if (!armed.armed) { console.error(armed.reason); process.exit(3); }`,
		`const boom = cc({ source: ${JSON.stringify(boom)}, symbols: { boom: { args: [], returns: FFIType.i32 } } });`,
		ending,
	].join("\n");
}

const FAULT = [`boom.symbols.boom();`, `process.exit(9);`].join("\n");

/**
 * What a timed-out wait was waiting for. A bare "timed out waiting for the guard" hides the
 * difference between a guard that exited without recording and one the runner never scheduled.
 */
function waitState(child: Subprocess | CrashGuard, root: string): string {
	const stopped = "running" in child ? child.running() === false : false;
	const exited = child.exitCode !== null || stopped;
	return `pid ${child.pid}, exited=${exited}, exitCode=${child.exitCode ?? "null"}, crashRecord=${existsSync(crashRecordPath(root))}, lastCrash=${existsSync(lastCrashPath(root))}`;
}

/**
 * Wait on the process's own exit event; the deadline is only a backstop. A poll around a file or
 * `running()` measures the runner's scheduling, and a 15 s budget with no state in its error
 * hides why the event never came.
 */
async function awaitExit(
	child: Subprocess | CrashGuard,
	label: string,
	root: string,
): Promise<number> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const backstop = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`timed out waiting for ${label}: ${waitState(child, root)}`)),
			EXIT_BACKSTOP_MS,
		);
	});
	try {
		return await Promise.race([child.exited, backstop]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Spawn the child, then its guard, then release the child. */
async function watch(root: string, ending: string): Promise<Subprocess> {
	const boom = join(root, "boom.c");
	const script = join(root, "child.ts");
	const go = join(root, "go");
	await writeFile(boom, BOOM_C, "utf8");
	await writeFile(script, childSource(boom, crashRecordPath(root), go, ending), "utf8");
	const child = Bun.spawn({
		cmd: [process.execPath, script],
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	children.push(child);
	guards.push(startCrashGuard({ appDataDir: root, pid: child.pid }));
	await writeFile(go, "1");
	return child;
}

describe("crash guard", () => {
	test("decodeCrashRecord reads the fixed 84-byte layout", () => {
		const bytes = new Uint8Array(CRASH_RECORD_BYTES);
		bytes.set([0x43, 0x52, 0x53, 0x48]);
		const view = new DataView(bytes.buffer);
		view.setInt32(4, 11, true);
		view.setInt32(8, 2, true);
		view.setBigUint64(12, 0xdeadbeefn, true);
		bytes.set(new TextEncoder().encode("SIGSEGV"), 20);
		expect(decodeCrashRecord(bytes)).toEqual({
			signal: 11,
			code: 2,
			address: 0xdeadbeefn,
			handler: "SIGSEGV",
		});
		expect(signalName(11)).toBe("SIGSEGV");
		expect(decodeCrashRecord(bytes.subarray(0, 40))).toBeNull();
		expect(decodeCrashRecord(new Uint8Array(CRASH_RECORD_BYTES))).toBeNull();
	});

	test("a child that faults on a null dereference is recorded by name, and the guard exits", async () => {
		const root = await tempDir();
		const child = await watch(root, FAULT);
		expect(await awaitExit(child, "the faulting child", root)).toBe(CRASH_EXIT_CODE);
		const guard = guards[guards.length - 1] as CrashGuard;
		expect(await awaitExit(guard, "the guard", root)).toBe(0);
		const crash = readLastCrash(root);
		if (crash === null) {
			throw new Error(
				`the guard exited without recording a crash: ${waitState(guard, root)}`,
			);
		}
		expect(crash.signal).toBe("SIGSEGV");
		expect(crash.handler).toBe("SIGSEGV");
		expect(crash.exitCode).toBe(CRASH_EXIT_CODE);
		expect(crash.address).toMatch(/^0x[0-9a-f]+$/);
		// The handler ran: the default SIGSEGV disposition would have reaped the child by signal.
		expect(listCrashes(root).map((entry) => entry.signal)).toEqual(["SIGSEGV"]);
		expect(processAlive(guard.pid)).toBe(false);
	}, 30_000);

	test("a child that exits cleanly records nothing", async () => {
		const root = await tempDir();
		const child = await watch(root, "process.exit(0);");
		expect(await awaitExit(child, "the clean child", root)).toBe(0);
		const guard = guards[guards.length - 1] as CrashGuard;
		await awaitExit(guard, "the guard", root);
		expect(readLastCrash(root)).toBeNull();
		expect(listCrashes(root)).toEqual([]);
	}, 30_000);

	test("stop() kills the guard and leaves no process behind", async () => {
		const root = await tempDir();
		const child = Bun.spawn({
			cmd: [process.execPath, "-e", "await Bun.sleep(30000)"],
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		children.push(child);
		const guard = startCrashGuard({ appDataDir: root, pid: child.pid });
		guards.push(guard);
		expect(guard.running()).toBe(true);
		expect(processAlive(guard.pid)).toBe(true);
		guard.stop();
		await awaitExit(guard, "the stopped guard", root);
		expect(guard.running()).toBe(false);
		expect(processAlive(guard.pid)).toBe(false);
	}, 30_000);
});
