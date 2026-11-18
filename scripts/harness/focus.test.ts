/**
 * Focus capture and restore are a courtesy around a GUI probe, so the only unit-testable edge is
 * the logic itself. `makeFocus` takes the command runner as a parameter: these tests never touch
 * the real frontmost app and never activate one, they replay results from an injected runner.
 */
import { readdir } from "node:fs/promises";
import { expect, test } from "bun:test";
import { EXEMPT, harnessImports, LAUNCHERS } from "./focus-callers.ts";
import { makeFocus, type CommandResult, type Runner } from "./focus.ts";

interface Call {
	command: string[];
	timeoutMs: number;
}

/** A runner that records each call and replays queued results. */
function recorder(...results: CommandResult[]): { runner: Runner; calls: Call[] } {
	const calls: Call[] = [];
	const runner: Runner = async (command, timeoutMs) => {
		calls.push({ command, timeoutMs });
		const next = results.shift();
		if (next === undefined) throw new Error("no queued result");
		return next;
	};
	return { runner, calls };
}

const ok = (stdout: string): CommandResult => ({ code: 0, stdout });

test("capture reads the frontmost app from a timeboxed osascript", async () => {
	const { runner, calls } = recorder(ok("  Brave\n"));
	const { captureFrontmost } = makeFocus(runner, "darwin");
	expect(await captureFrontmost()).toBe("Brave");
	expect(calls).toHaveLength(1);
	expect(calls[0]!.command[0]).toBe("osascript");
	expect(calls[0]!.command[1]).toBe("-e");
	expect(calls[0]!.command[2]).toContain("frontmost is true");
	expect(calls[0]!.timeoutMs).toBeGreaterThan(0);
});

test("capture returns undefined when osascript fails or prints nothing", async () => {
	const failed = makeFocus(recorder({ code: 1, stdout: "Brave" }).runner, "darwin");
	expect(await failed.captureFrontmost()).toBeUndefined();
	const blank = makeFocus(recorder(ok("   \n")).runner, "darwin");
	expect(await blank.captureFrontmost()).toBeUndefined();
});

test("capture swallows a runner failure", async () => {
	const runner: Runner = async () => {
		throw new Error("osascript wedged");
	};
	const { captureFrontmost } = makeFocus(runner, "darwin");
	expect(await captureFrontmost()).toBeUndefined();
});

test("capture is a no-op off macOS", async () => {
	const { runner, calls } = recorder(ok("Brave"));
	const { captureFrontmost } = makeFocus(runner, "linux");
	expect(await captureFrontmost()).toBeUndefined();
	expect(calls).toHaveLength(0);
});

test("restore activates the captured app", async () => {
	const { runner, calls } = recorder(ok(""));
	const { restoreFocus } = makeFocus(runner, "darwin");
	await restoreFocus("Brave");
	expect(calls).toHaveLength(1);
	expect(calls[0]!.command).toEqual(["open", "-a", "Brave"]);
	expect(calls[0]!.timeoutMs).toBeGreaterThan(0);
});

test("restore falls back to Ghostty when nothing was captured", async () => {
	const { runner, calls } = recorder(ok(""));
	const { restoreFocus } = makeFocus(runner, "darwin");
	await restoreFocus();
	expect(calls[0]!.command).toEqual(["open", "-a", "Ghostty"]);
});

test("restore swallows a runner failure rather than failing a run", async () => {
	const runner: Runner = async () => {
		throw new Error("open missing");
	};
	const { restoreFocus } = makeFocus(runner, "darwin");
	await expect(restoreFocus("Brave")).resolves.toBeUndefined();
});

test("restore is a no-op off macOS", async () => {
	const { runner, calls } = recorder(ok(""));
	const { restoreFocus } = makeFocus(runner, "linux");
	await restoreFocus("Brave");
	expect(calls).toHaveLength(0);
});

/**
 * The classification lives in `focus-callers.ts`; what is asserted here is that it is total.
 * `captureFrontmost` plus a `finally` covers a normal or thrown return, and only `guardFocus()`
 * covers `exit` and the three signals — so a suite with the first and not the second still steals
 * focus when the human presses Ctrl-C. The set is read from disk, so a new suite fails until it is
 * wired: the old list only checked that twelve named files still contained a string, which is why
 * a suite calling neither capture nor restore was invisible to it.
 */
test("every GUI-launching script arms the focus guard, not only the finally", async () => {
	for (const file of LAUNCHERS) {
		const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
		expect(text, `${file} calls guardFocus()`).toContain("guardFocus();");
		expect(harnessImports(text), `${file} imports guardFocus from the harness`).toContain(
			"guardFocus",
		);
		expect(text, `${file} captures the frontmost app`).toContain("captureFrontmost()");
		expect(text, `${file} restores that app`).toContain("restoreFocus(frontmost)");
		expect(text, `${file} has no bare restoreFocus()`).not.toMatch(/await restoreFocus\(\);/);
	}
});

test("every top-level script is classified: a launcher, or an exemption with its reason", async () => {
	const onDisk = (await readdir(new URL("../", import.meta.url)))
		.filter((name) => name.endsWith(".ts"))
		.sort();
	const exempt = EXEMPT.flatMap((group) => group.files);
	// Both directions in one equality: an unclassified file fails, and so does a stale entry that
	// names nothing on disk. A file in both lists shows up as a length mismatch, not a silent pass.
	expect([...LAUNCHERS, ...exempt].sort()).toEqual(onDisk);
	for (const group of EXEMPT) {
		expect(group.reason.length, `${group.files[0]} says why it is exempt`).toBeGreaterThan(40);
	}
	for (const file of exempt) {
		const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
		expect(text, `${file} is exempt, so it must not arm the guard too`).not.toContain(
			"guardFocus()",
		);
	}
});

test("one-off probe shells restore the captured app, not a hardcoded Ghostty", async () => {
	for (const file of ["probe-notif.sh", "probe-vite.sh"]) {
		const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
		expect(text, `${file} captures the frontmost app`).toContain("FRONTMOST=");
		expect(text, `${file} restores that app`).toContain('"${FRONTMOST:-Ghostty}"');
		expect(text, `${file} has no hardcoded target`).not.toContain("open -a Ghostty");
	}
});
