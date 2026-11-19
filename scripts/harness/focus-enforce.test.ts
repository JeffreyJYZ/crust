/**
 * Focus-restore enforcement, proved statically. Nothing here launches a GUI app: the detector reads
 * source text, and the "real case" is a temporary file at the repo root that is written, caught and
 * deleted. What this prevents: a throwaway probe at the root (or under examples/, research/ or
 * spike/) taking the screen with no focus capture, invisible to the old scripts/-only name list.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	canTakeScreen,
	findUnarmed,
	fixMessage,
	isArmed,
	probeFiles,
	SCREEN_RULES,
	stripComments,
	unarmedReason,
} from "./focus-callers.ts";

const REPO = new URL("../../", import.meta.url).pathname;

test("the detector's rules are named behaviour, printed for the gate", () => {
	// Quoted so a reviewer sees exactly what counts as taking the screen.
	for (const rule of SCREEN_RULES) console.log(`  rule: ${rule.name}`);
	expect(SCREEN_RULES.length).toBeGreaterThanOrEqual(5);
	for (const rule of SCREEN_RULES) {
		expect(rule.name.length).toBeGreaterThan(10);
		expect(rule.match).toBeInstanceOf(RegExp);
	}
});

test("each launch shape is detected from source text", () => {
	expect(canTakeScreen('Bun.spawn(["dist/Probe.app/Contents/MacOS/crust-app"]);')).toBe(
		"spawns a built .app binary",
	);
	expect(canTakeScreen('Bun.spawn(["dist/crust-app"]);')).toBe("spawns a path under dist/");
	expect(canTakeScreen("createNativeWindow({ title: 'x' });")).toBe("calls createNativeWindow");
	expect(canTakeScreen('Bun.spawn(["open", "-a", "Preview"]);')).toBe(
		"opens an app with `open -a`",
	);
	expect(canTakeScreen('await run("crust dev");\nBun.spawn([bin]);')).toBe(
		"runs crust dev/build then launches the result",
	);
});

test("comments do not trip a rule; a bare mention of .app is not a launch", () => {
	expect(canTakeScreen('// Bun.spawn(["dist/Probe.app/Contents/MacOS/crust-app"])')).toBeUndefined();
	expect(canTakeScreen('const path = "dist/Probe.app/Contents/MacOS/crust-app";')).toBeUndefined();
	expect(stripComments("const u = 'https://x/y'; // note")).toContain("https://x/y");
});

test("arming is recognised: guard, raw capture/restore pair, or probe-run", () => {
	expect(isArmed("const frontmost = guardFocus();")).toBe(true);
	expect(isArmed("const a = captureFrontmost(); await restoreFocus(a);")).toBe(true);
	expect(isArmed("// run under probe-run -c")).toBe(true);
	expect(isArmed("Bun.spawn(['dist/App.app/Contents/MacOS/crust-app']);")).toBe(false);
	const probe = 'Bun.spawn(["dist/Probe.app/Contents/MacOS/crust-app"]);';
	expect(unarmedReason(probe)).toBe("spawns a built .app binary");
	expect(unarmedReason(`${probe}\nconst frontmost = guardFocus();`)).toBeUndefined();
});

test("scan covers root one-offs and the probe trees, not just scripts/", async () => {
	const files = await probeFiles(REPO);
	expect(files.some((file) => file.startsWith("examples/"))).toBe(true);
	expect(files.some((file) => file.startsWith("research/"))).toBe(true);
	expect(files.some((file) => file.startsWith("spike/"))).toBe(true);
});

test("a temporary root probe fails the check by name with the fix, then the tree passes", async () => {
	const name = ".focus-enforce-probe.ts";
	const path = join(REPO, name);
	const probe = [
		"// throwaway probe: launch the built app and leave the screen taken",
		'Bun.spawn(["dist/Probe.app/Contents/MacOS/crust-app"]);',
		"",
	].join("\n");
	try {
		await Bun.write(path, probe);
		const failures = await findUnarmed(REPO);
		const hit = failures.find((line) => line.includes(name));
		expect(hit).toBeDefined();
		expect(hit).toBe(fixMessage(name, "spawns a built .app binary"));
		expect(hit).toContain("probe-run -c");
		expect(hit).toContain("guardFocus()");
	} finally {
		await rm(path, { force: true });
	}
	expect(await findUnarmed(REPO)).toEqual([]);
});
