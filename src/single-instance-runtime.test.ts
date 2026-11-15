/**
 * The launch order's single-instance step: `claimSingleInstance` takes the lock
 * before anything native exists, and `quitSecondInstance` is what a refused
 * launch does. Both are callable here with no AppKit, no window and no real
 * process, which is the point — the refusal path is a plain function.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrustConfig } from "@/config";
import { isNotImplemented, notImplemented } from "@/plugins/define";
import type { SingleInstanceAdapter } from "@/plugins/single-instance";
import {
	claimSingleInstance,
	type ClaimOptions,
	lockName,
	quitSecondInstance,
	SINGLE_INSTANCE_VAR,
} from "./runtime-single";

/** macOS caps pids at 99998, so this one cannot exist. */
const DEAD_PID = 999_999;
/** launchd: always alive, never ours, so `kill(1, 0)` answers EPERM. */
const LIVE_FOREIGN_PID = 1;

const config: CrustConfig = {
	app: { id: "land.jyz.notes", name: "notes", version: "0.0.0" },
	windows: [{ label: "main" }],
};

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-single-runtime-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Records what `activate` was asked to raise; `status` 0 is the only success. */
function fakeAdapter(status = 0): { adapter: SingleInstanceAdapter; raised: number[] } {
	const raised: number[] = [];
	return {
		raised,
		adapter: {
			activate(pid) {
				raised.push(pid);
				return { status, reason: `status ${status}` };
			},
		},
	};
}

function claimIn(dir: string, extra: Partial<ClaimOptions> = {}) {
	return claimSingleInstance({
		config,
		dir,
		platform: "darwin",
		env: {},
		adapter: fakeAdapter().adapter,
		...extra,
	});
}

describe("the launch claim", () => {
	test("takes <dir>/<id>.lock for this process, re-entrantly, and registers the plugin", async () => {
		const dir = tempDir();
		const claim = await claimIn(dir);
		const path = join(dir, "land.jyz.notes.lock");

		expect(claim.acquired).toBe(true);
		expect(claim.skipped).toBeUndefined();
		expect(claim.pid).toBe(process.pid);
		expect(readFileSync(path, "utf8").trim()).toBe(String(process.pid));
		expect(claim.plugin.name).toBe("single-instance");
		// A second claim in this process is the same lock, not a refusal.
		expect((await claimIn(dir)).acquired).toBe(true);
		// The page reaches the same lock through the plugin instance.
		expect(claim.plugin.commands.acquire({ id: "land.jyz.notes" }).acquired).toBe(true);
	});

	test("a live foreign holder refuses, names its pid, and its lock is untouched", async () => {
		const dir = tempDir();
		const path = join(dir, "land.jyz.notes.lock");
		writeFileSync(path, `${LIVE_FOREIGN_PID}\n`);
		const { adapter, raised } = fakeAdapter(0);

		const claim = await claimIn(dir, { adapter });
		expect(claim.acquired).toBe(false);
		expect(claim.pid).toBe(LIVE_FOREIGN_PID);
		expect(readFileSync(path, "utf8").trim()).toBe(String(LIVE_FOREIGN_PID));

		const lines: string[] = [];
		await quitSecondInstance(claim.pid, {
			activate: claim.activate,
			report: (l) => lines.push(l),
		});
		expect(raised).toEqual([LIVE_FOREIGN_PID]);
		expect(lines).toEqual([
			`  single    raised the running instance (pid ${LIVE_FOREIGN_PID})`,
		]);
	});

	test("a lock naming a dead pid is stale and is taken over", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "land.jyz.notes.lock"), `${DEAD_PID}\n`);

		const claim = await claimIn(dir);
		expect(claim.acquired).toBe(true);
		expect(readFileSync(join(dir, "land.jyz.notes.lock"), "utf8").trim()).toBe(
			String(process.pid),
		);
	});

	test("release removes this process's lock, and a second release is harmless", async () => {
		const dir = tempDir();
		const claim = await claimIn(dir);
		const path = join(dir, "land.jyz.notes.lock");

		claim.release();
		expect(existsSync(path)).toBe(false);
		expect(() => claim.release()).not.toThrow();
	});
});

describe("the refused launch", () => {
	test("reports a failed raise instead of pretending it worked", async () => {
		const lines: string[] = [];

		await quitSecondInstance(4242, {
			activate: async () => ({
				activated: false,
				status: 3,
				reason: "the system refused the activation",
			}),
			report: (line) => lines.push(line),
		});

		expect(lines).toEqual([
			"  single    another instance holds the lock (pid 4242); raising it failed: the system refused the activation",
		]);
	});

	test("says so when the build cannot raise another process at all", async () => {
		const lines: string[] = [];
		const answer = notImplemented("no NSRunningApplication", "NSRunningApplication");

		await quitSecondInstance(4242, {
			activate: async () => answer,
			report: (line) => lines.push(line),
		});

		expect(isNotImplemented(answer)).toBe(true);
		expect(lines).toEqual([
			"  single    another instance holds the lock (pid 4242) and this build cannot raise it",
		]);
	});
});

describe("when the check is skipped", () => {
	test(`${SINGLE_INSTANCE_VAR}=0 turns it off and creates no lock`, async () => {
		const dir = tempDir();
		const claim = await claimIn(dir, { env: { [SINGLE_INSTANCE_VAR]: "0" } });

		expect(claim.acquired).toBe(true);
		expect(claim.skipped).toBe("disabled");
		expect(existsSync(join(dir, "land.jyz.notes.lock"))).toBe(false);
	});

	test("a headless bridge never locks: nothing opens a window", async () => {
		const dir = tempDir();
		const claim = await claimIn(dir, { attachPlatform: false });

		expect(claim.skipped).toBe("headless");
		expect(existsSync(join(dir, "land.jyz.notes.lock"))).toBe(false);
	});

	test("a platform that cannot raise another copy never locks", async () => {
		const dir = tempDir();
		const claim = await claimIn(dir, { platform: "linux", adapter: undefined });

		expect(claim.skipped).toBe("unsupported");
		expect(existsSync(join(dir, "land.jyz.notes.lock"))).toBe(false);
	});
});

describe("the lock name", () => {
	test("keeps an app id, and folds anything that could leave the directory", () => {
		expect(lockName("land.jyz.notes")).toBe("land.jyz.notes");
		expect(lockName("a/b")).toBe("a_b");
		expect(lockName("a\\b")).toBe("a_b");
		expect(lockName("")).toBe("crust-app");
		expect(lockName("..")).toBe("crust-app");
	});
});
