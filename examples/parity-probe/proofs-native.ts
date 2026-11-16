/**
 * The dock, power and accessibility proofs: three surfaces whose answer comes from macOS rather
 * than from a field the framework keeps. Each builds the real darwin adapter, so every line is what
 * AppKit, IOKit or ApplicationServices reported at that moment, and each restores what it changed.
 */
import { createAccessibilityPlugin, createDockPlugin, createPowerPlugin } from "crust/plugin";
import { darwinAccessibilityAdapter } from "../../src/platform/darwin/accessibility.ts";
import { darwinDockAdapter } from "../../src/platform/darwin/dock.ts";
import { darwinPowerAdapter } from "../../src/platform/darwin/power.ts";
import { externalAx } from "./ax-probe.ts";
import { mark, reason } from "./proofs.ts";

type Answered = { ok?: boolean; label?: string };
type Powered = { ok?: boolean; onAc?: boolean; batteryPercent?: number | null };
type Idle = { ok?: boolean; seconds?: number };
type Trusted = { ok?: boolean; trusted?: boolean };
type Counted = { ok?: boolean; count?: number; code?: string; message?: string };

/** The badge is set, read back, cleared and read back empty — AppKit is the only witness. */
export async function proveDock(): Promise<boolean> {
	const dock = createDockPlugin(darwinDockAdapter());
	const label = String(process.pid);
	let wrote = false;
	let read = "";
	let cleared = false;
	let why = "";
	try {
		wrote = ((await dock.commands.badge({ label })) as Answered).ok === true;
		read = String(((await dock.commands.badgeLabel()) as Answered).label ?? "");
		// The empty label is the documented clear, and it goes through the same command a page would
		// call: no reaching past the adapter to the C export.
		cleared = ((await dock.commands.badge({ label: "" })) as Answered).ok === true;
	} catch (error) {
		why = reason(error);
	}
	const after = (await dock.commands.badgeLabel()) as Answered;
	const gone = after.label === "";
	const done = cleared && gone;
	console.log(`dock      badge="${label}" read="${read}" cleared=${done}`);
	if (!done) console.log(`dock      clear refused: ${why || "the tile still shows a badge"}`);
	return mark("dock", wrote && read === label && done);
}

/**
 * `state()` and `idleSeconds()` only. `sleepPrevent` is never called: an assertion this probe did
 * not release would keep the machine awake, and proving the read path needs no assertion at all.
 */
export async function provePower(): Promise<boolean> {
	const power = createPowerPlugin(darwinPowerAdapter());
	const state = (await power.commands.state()) as Powered;
	const idle = (await power.commands.idleSeconds()) as Idle;
	// A desktop has no battery, which is a real answer and not a missing one.
	const battery = state.batteryPercent ?? null;
	const sane = battery === null || (battery >= 0 && battery <= 100);
	const seconds = Math.round(idle.seconds ?? 0);
	const ok = state.ok === true && typeof state.onAc === "boolean" && idle.ok === true && sane;
	console.log(
		`power     ac=${state.onAc === true} battery=${battery ?? "none"} idle=${seconds}s`,
	);
	return mark("power", ok);
}

/**
 * `trusted()`, the app's own `elementCount()`, and — the measurement that means anything — an
 * external read. A process reading its own pid is answered by AppKit locally, so its empty window
 * list says nothing about what the app exposes; a separate trusted process reading this pid does.
 * `prompt()` is never sent, because a person has to answer it.
 */
export async function proveAccessibility(): Promise<boolean> {
	const ax = createAccessibilityPlugin(darwinAccessibilityAdapter());
	let trusted: Trusted = {};
	let counted: Counted = {};
	let why = "";
	try {
		trusted = (await ax.commands.trusted()) as Trusted;
		counted = (await ax.commands.elementCount()) as Counted;
		// The AX server registers a window a moment after it is ordered front, so a fresh launch
		// can answer "no windows listed" once and count it on the next read.
		for (let attempt = 0; attempt < 5 && counted.ok !== true; attempt++) {
			await Bun.sleep(100);
			counted = (await ax.commands.elementCount()) as Counted;
		}
	} catch (error) {
		why = reason(error);
	}
	const self = counted.ok === true ? String(counted.count ?? -1) : "none";
	const external = await externalAx(process.pid);
	if (typeof external === "string") {
		console.log(`accessibility ax self=${self} external=refused: ${external}`);
		// AX switched off for this process is an environment answer, not a defect; anything else is
		// an unproven surface and stays red.
		return mark("accessibility", trusted.trusted === false);
	}
	if (external.status !== 0) {
		const line = `the AX API answered ${external.status}`;
		console.log(`accessibility ax self=${self} external=refused: ${line}`);
		return mark("accessibility", trusted.trusted === false);
	}
	// A separate process seeing at least one window is what "the app exposes an AX tree" means.
	const exposed = external.windows >= 1;
	const detail = `windows:${external.windows},children:${external.children},status:${external.status}`;
	const tail = exposed ? "" : " — the app does not expose its window to other processes";
	console.log(`accessibility ax self=${self} external=${detail}${tail}`);
	if (!exposed) {
		console.log(`accessibility self refused: ${counted.message ?? (why || "no reason")}`);
	}
	return mark("accessibility", exposed && trusted.ok === true);
}
