/**
 * Focus capture and restore are a courtesy around a GUI probe, so the only unit-testable edge is
 * the logic itself. `makeFocus` takes the command runner as a parameter: these tests never touch
 * the real frontmost app and never activate one, they replay results from an injected runner.
 */
import { expect, test } from "bun:test";
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

/** Every e2e caller must save the frontmost app before it restores one. */
const CALLERS = [
	"e2e.ts",
	"e2e-dev.ts",
	"e2e-dev-binary.ts",
	"e2e-dev-react.ts",
	"e2e-dogear.ts",
	"e2e-native.ts",
	"e2e-notes.ts",
	"e2e-notify.ts",
	"e2e-parity.ts",
	"e2e-single.ts",
	"e2e-window.ts",
	"first-run.ts",
];

test("no caller restores focus without first capturing it", async () => {
	for (const file of CALLERS) {
		const text = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
		expect(text, `${file} captures the frontmost app`).toContain("captureFrontmost()");
		expect(text, `${file} restores that app`).toContain("restoreFocus(frontmost)");
		expect(text, `${file} has no bare restoreFocus()`).not.toMatch(/await restoreFocus\(\);/);
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
