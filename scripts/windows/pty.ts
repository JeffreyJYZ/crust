/**
 * The real ConPTY proof: `crust:pty` opened, typed into, resized and closed through the same
 * Windows wiring a shipped app uses (`featurePlugins` picks the ConPTY backend on `win32`).
 *
 * Nothing else in this tree can prove it: `Bun.Terminal` is POSIX-only, the pseudo-console, the two
 * pipe pairs and the attribute list only exist on Windows, and every other test drives a fake shim.
 *
 * What is asserted: a shell opens with a pid, a command typed in produces output the page receives
 * as base64 `pty-data` (the marker is arithmetic, so the console's own echo of the command cannot
 * satisfy it), a resize is accepted and the shell still answers after it, and the child is gone
 * once `close` returns.
 */
import { ptr } from "bun:ffi";
import { cstring } from "../../src/platform/windows/cstring.ts";
import { environmentBlock } from "../../src/platform/windows/pty-conpty.ts";
import { conptyShim } from "../../src/platform/windows/pty-ffi.ts";
import { featurePlugins } from "../../src/runtime-feature-plugins.ts";
import type { PluginContext } from "../../src/plugins/define.ts";
import type { PtyCommands } from "../../src/plugins/pty.ts";

export interface PtyCheck {
	name: string;
	ok: boolean;
	detail: string;
}

/** The shell a Windows host runs when `pty.shell` names none — the same default `pty-host` uses. */
function hostShell(): string {
	return process.env.ComSpec ?? "cmd.exe";
}

function waitForText(text: () => string, needle: string, ms = 10000): Promise<boolean> {
	return new Promise((resolve) => {
		const deadline = performance.now() + ms;
		const poll = (): void => {
			if (text().includes(needle)) return resolve(true);
			if (performance.now() >= deadline) return resolve(false);
			setTimeout(poll, 25);
		};
		poll();
	});
}

/** Whether a pid left the process table; `signal 0` asks the OS without touching the process. */
function waitForGone(pid: number, ms = 5000): Promise<boolean> {
	return new Promise((resolve) => {
		const deadline = performance.now() + ms;
		const poll = (): void => {
			try {
				process.kill(pid, 0);
			} catch {
				return resolve(true);
			}
			if (performance.now() >= deadline) return resolve(false);
			setTimeout(poll, 25);
		};
		poll();
	});
}

async function ptyCommands(shell: string): Promise<PtyCommands> {
	const plugin = (await featurePlugins({ pty: { shell } }, "win32")).find(
		(candidate) => candidate.name === "pty",
	);
	if (plugin === undefined) throw new Error("the pty section registered no plugin");
	return plugin.commands as PtyCommands;
}

/**
 * The same console with a client that writes one line and exits, driven through the shim with no
 * plugin in between: it says whether the pipe carries bytes at all, which an interactive banner
 * cannot, because a shell waiting on its own console and a dead pipe look identical from outside.
 */
async function rawProbe(): Promise<PtyCheck> {
	const shim = conptyShim();
	if (Number(shim.shim_pty_load()) !== 1) {
		return {
			name: "pty:raw",
			ok: false,
			detail: `kernel32!${shim.shim_pty_missing() ?? "an export"} did not resolve`,
		};
	}
	const index = Number(
		shim.shim_pty_open(
			cstring(hostShell()),
			cstring('/d /c "echo conpty-raw"'),
			cstring(process.env.USERPROFILE ?? process.cwd()),
			environmentBlock(process.env as Record<string, string>),
			100,
			30,
		),
	);
	if (index < 0) {
		return { name: "pty:raw", ok: false, detail: shim.shim_pty_reason() ?? "open refused" };
	}
	// A ConPTY emits its own VT setup before the client's first line, so "one byte arrived" says
	// nothing about the data path. Read until the marker or the deadline.
	const deadline = performance.now() + 10000;
	const buffer = new Uint8Array(8192);
	let seen = "";
	while (performance.now() < deadline) {
		const got = Number(shim.shim_pty_read(index, ptr(buffer), buffer.length));
		if (got > 0) seen += Buffer.from(buffer.slice(0, got)).toString("utf8");
		else if (seen.includes("conpty-raw")) break;
		else await Bun.sleep(25);
	}
	const total = Number(shim.shim_pty_total(index));
	shim.shim_pty_close(index);
	return {
		name: "pty:raw",
		ok: seen.includes("conpty-raw"),
		detail: `${total} byte(s) from cmd /c echo: ${JSON.stringify(seen.slice(0, 160))}`,
	};
}

export async function provePty(): Promise<PtyCheck[]> {
	const checks: PtyCheck[] = [await rawProbe()];
	const frames: string[] = [];
	const ctx: PluginContext = {
		emit: (event, data): void => {
			if (event === "pty-data") frames.push((data as { chunk: string }).chunk);
		},
	};
	const text = (): string =>
		Buffer.concat(frames.map((frame) => Buffer.from(frame, "base64"))).toString("utf8");
	const pty = await ptyCommands(hostShell());
	const opened = pty.open({ cols: 100, rows: 30 }, ctx);
	if (!("ok" in opened) || opened.ok !== true) {
		checks.push({ name: "pty", ok: false, detail: JSON.stringify(opened).slice(0, 200) });
		return checks;
	}
	const { id, pid } = opened as { id: string; pid: number };
	checks.push({
		name: "pty",
		ok: pid > 0,
		detail: `ConPTY ${id} opened a shell with pid ${pid} at 100x30`,
	});

	// Arithmetic, not a literal: the console echoes the command line, so only real output carries
	// the sum. A page decodes base64, so the assertion is on the bytes, never on the frame text.
	// Wait for the prompt first: a shell that has not started reading input yet is not a pty bug.
	const ready = await waitForText(text, ">");
	const typed = pty.write({ id, data: "set /a 1234+5678\r\n" });
	const produced = await waitForText(text, "6912");
	checks.push({
		name: "pty:output",
		ok:
			ready &&
			typed.ok === true &&
			produced &&
			frames.every((frame) => /^[A-Za-z0-9+/=]+$/.test(frame)),
		detail: produced
			? `6912 arrived in ${frames.length} base64 pty-data frame(s)`
			: `prompt ${ready}, write ${JSON.stringify(typed)}; ` +
				`the last frames were: ${JSON.stringify(text().slice(-160))}; ` +
				`shim: ${conptyShim().shim_pty_reason() ?? "no reason recorded"}`,
	});

	const resized = pty.resize({ id, cols: 80, rows: 24 });
	const alive = resized.ok === true;
	pty.write({ id, data: "set /a 111*111\r\n" });
	const afterwards = await waitForText(text, "12321");
	checks.push({
		name: "pty:resize",
		ok: alive && afterwards,
		detail: alive
			? `resize to 80x24 accepted; the shell answered ${afterwards ? "afterwards" : "nothing"}`
			: JSON.stringify(resized).slice(0, 160),
	});

	const closed = pty.close({ id });
	const gone = await waitForGone(pid);
	checks.push({
		name: "pty:close",
		ok: closed.ok === true && gone && !pty.list().ids.includes(id),
		detail: gone
			? `pid ${pid} is gone and ${id} left the list after close`
			: `pid ${pid} is still in the process table after close`,
	});
	return checks;
}
