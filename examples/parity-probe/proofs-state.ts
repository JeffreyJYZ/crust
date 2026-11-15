/**
 * The autostart, logging, window-state and positioner proofs: four surfaces whose whole contract is
 * a file on disk or arithmetic over an injected screen. Each runs against a temp root, so the real
 * `~/Library/LaunchAgents` and `Application Support` are never touched, and every line is the state
 * read back after the call rather than the call's own claim.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAutostartPlugin,
	createLoggingPlugin,
	createPositionerPlugin,
	createWindowStatePlugin,
} from "crust/plugin";
import { fakeWindow } from "../../src/plugins/window-persist-fake.ts";
import { mark, reason } from "./proofs.ts";

const BUNDLE_ID = "land.jyz.parity-probe";
const LABEL = "parity-state";
const FRAME = { x: 100, y: 120, width: 800, height: 600 };
const SCREEN = { x: 0, y: 25, width: 1440, height: 875 };

/** A temp root per proof; the caller's `finally` removes it. */
function tempRoot(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `crust-parity-${name}-`));
}

function failed(name: string, detail: string): boolean {
	console.log(`${name.padEnd(9)} failed: ${detail}`);
	return mark(name, false);
}

/** `enable` writes the plist, `isEnabled` finds it, `disable` removes it — all under a temp home. */
export async function proveAutostart(): Promise<boolean> {
	let home: string | undefined;
	try {
		home = await tempRoot("autostart");
		const autostart = createAutostartPlugin({ home, bundleId: BUNDLE_ID });
		const plist = join(home, "Library", "LaunchAgents", `${BUNDLE_ID}.plist`);
		// The running binary stands in for the `.app` bundle: it exists, which is what `enable` checks.
		const enabled = await autostart.commands.enable({
			appPath: process.execPath,
			bundleId: BUNDLE_ID,
		});
		const written = enabled.ok === true && existsSync(plist);
		const status = await autostart.commands.isEnabled();
		const live = status.ok === true && status.enabled === true;
		const off = await autostart.commands.disable();
		const gone = off.ok === true && !existsSync(plist);
		console.log(
			`autostart plist=${written ? "written" : "missing"} enabled=${live} removed=${gone}`,
		);
		return mark("autostart", written && live && gone);
	} catch (error) {
		return failed("autostart", reason(error));
	} finally {
		if (home !== undefined) await rm(home, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** 1 KiB lines, so the sink crosses its 1 MiB threshold and both files together hold every line. */
const LINE_CHARS = 1024;
const LINE_COUNT = 1100;

export async function proveLogging(): Promise<boolean> {
	let root: string | undefined;
	try {
		root = await tempRoot("logging");
		const logging = createLoggingPlugin({ root });
		const lines: string[] = [];
		let rotated = false;
		for (let index = 0; index < LINE_COUNT; index += 1) {
			const tag = String(index).padStart(4, "0");
			const message = `${tag} ${"x".repeat(LINE_CHARS - tag.length - 1)}`;
			const answer = await logging.commands.write({ level: "info", message });
			if (answer.written !== true) {
				return failed("logging", `write refused: ${answer.reason ?? answer.error ?? "unknown"}`);
			}
			if (answer.line !== undefined) lines.push(answer.line);
			if (answer.rotated !== undefined) rotated = true;
		}
		const live = join(root, "logs", "app.log");
		const archive = join(root, "logs", "app.log.1");
		const before = await readFile(archive, "utf8").catch(() => "");
		const after = await readFile(live, "utf8").catch(() => "");
		// A set, not `includes`: a 1 KiB needle against 1 MiB of text is quadratic per line.
		const seen = new Set([...before.split("\n"), ...after.split("\n")]);
		const kept = lines.every((line) => seen.has(line));
		const ok = rotated && existsSync(archive) && kept && lines.length === LINE_COUNT;
		console.log(`logging rotated=${rotated} lines=${lines.length}`);
		return mark("logging", ok);
	} catch (error) {
		return failed("logging", reason(error));
	} finally {
		if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** The repo's own fake adapter: real frames in a map, so a restore is proved by reading one back. */
export async function proveWindowState(): Promise<boolean> {
	let root: string | undefined;
	try {
		root = await tempRoot("window-state");
		const native = fakeWindow({ [LABEL]: FRAME });
		const state = createWindowStatePlugin({ native, root });
		const saved = (await state.commands.saveAll()) as { ok?: boolean; saved?: string[] };
		const named = saved.ok === true && (saved.saved ?? []).includes(LABEL);
		const frame = native.windows.get(LABEL);
		if (frame === undefined) return failed("window-state", `no frame for ${LABEL}`);
		Object.assign(frame, { x: 0, y: 0, width: 10, height: 10 });
		const restored = (await state.commands.restoreAll()) as { ok?: boolean; restored?: string[] };
		const back = native.windows.get(LABEL) ?? { x: -1, y: -1, width: -1, height: -1 };
		const same =
			back.x === FRAME.x &&
			back.y === FRAME.y &&
			back.width === FRAME.width &&
			back.height === FRAME.height;
		const ok = named && (restored.restored ?? []).includes(LABEL) && same;
		console.log(`window-state saved=${JSON.stringify(saved.saved ?? [])} restored=${same}`);
		return mark("window-state", ok);
	} catch (error) {
		return failed("window-state", reason(error));
	} finally {
		if (root !== undefined) await rm(root, { recursive: true, force: true }).catch(() => undefined);
	}
}

type Placed = { ok?: boolean; x?: number; y?: number };

/** The injected screen is `{0,25,1440,875}`, so an 800x600 window lands on fixed whole points. */
export async function provePositioner(): Promise<boolean> {
	const native = fakeWindow({ [LABEL]: FRAME });
	const positioner = createPositionerPlugin({ native, screen: SCREEN });
	const center = (await positioner.commands.center({ label: LABEL })) as Placed;
	const topLeft = (await positioner.commands.topLeft({ label: LABEL })) as Placed;
	const bottomRight = (await positioner.commands.bottomRight({ label: LABEL })) as Placed;
	const corners =
		topLeft.ok === true &&
		topLeft.x === 0 &&
		topLeft.y === 300 &&
		bottomRight.ok === true &&
		bottomRight.x === 640 &&
		bottomRight.y === 25;
	const at = native.windows.get(LABEL);
	const applied = at?.x === 640 && at?.y === 25;
	const line = `positioner center=${center.x ?? "?"},${center.y ?? "?"}`;
	console.log(`${line} corners=${corners ? "ok" : "wrong"}`);
	const placed = center.ok === true && center.x === 320 && center.y === 163;
	return mark("positioner", placed && corners && applied);
}
