/**
 * E2E for `crust:pty`: a real pty a page drives, proven without a window.
 *
 * The plugin is mounted exactly as `nativePlugins` mounts it — `createPtyPlugin({ shell })` with a
 * plugin context whose `emit` is the bridge's server-sent event channel — and then driven the way a
 * page would: `open`, a typed command, the bytes read back out of `pty-data`, `close`. Nothing is
 * mocked: the terminal is `Bun.Terminal` and the program is a real `/bin/sh`.
 *
 * The two assertions a unit test cannot make are here: the child is gone from the process table
 * after `close`, and the reap set is empty, so a terminal cannot outlive the app that opened it.
 */
import { liveChildren } from "@/child-reap";
import { createPtyPlugin } from "@/plugins/pty";
import { Verdict } from "./e2e-harness.ts";

const SHELL = "/bin/sh";

interface Frame {
	chunk: string;
}

/** Poll until `needle` appears in the decoded stream, bounded so a silent pty fails rather than hangs. */
async function waitForText(text: () => string, needle: string, ms = 5000): Promise<boolean> {
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		if (text().includes(needle)) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return false;
}

/** Whether a pid left the process table; a signalled child takes a moment to be reaped. */
async function gone(pid: number, ms = 3000): Promise<boolean> {
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return false;
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	const seen = { frames: [] as Frame[] };
	const sink = (event: string, data: unknown): void => {
		if (event === "pty-data") seen.frames.push(data as Frame);
	};
	const text = (): string =>
		Buffer.concat(seen.frames.map((frame) => Buffer.from(frame.chunk, "base64"))).toString(
			"utf8",
		);
	const plugin = createPtyPlugin({ shell: SHELL });

	const opened = plugin.commands.open({ cols: 100, rows: 30 }, { emit: sink });
	verdict.check("open", opened.ok === true, JSON.stringify(opened).slice(0, 160));
	if (!opened.ok || !("pid" in opened)) return verdict.report("e2e-pty");
	const { id, pid } = opened;

	// A command typed the way a user types it: one write, the shell's own echo comes back too.
	const typed = plugin.commands.write({ id, data: "stty size; echo e2e-$((6*7))\n" });
	verdict.check("write", typed.ok === true, JSON.stringify(typed).slice(0, 160));

	const sized = await waitForText(text, "30 100");
	verdict.check("size", sized, `a 100x30 pty reported by stty: ${sized ? "30 100" : "nothing"}`);

	const output = await waitForText(text, "e2e-42");
	verdict.check(
		"typed output",
		output,
		`typed command's output arrived in ${seen.frames.length} pty-data frame(s)`,
	);
	verdict.check(
		"base64 frames",
		seen.frames.length > 0 && seen.frames.every((frame) => frame.chunk.length > 0),
		`every frame carries bytes, first frame is ${seen.frames[0]?.chunk.slice(0, 24) ?? "none"}…`,
	);
	verdict.check(
		"typed echo",
		text().includes("stty size"),
		"the shell echoed the typed line, so the child really received keystrokes",
	);

	const closed = plugin.commands.close({ id });
	verdict.check(
		"close",
		closed.ok === true && closed.closed === true,
		JSON.stringify(closed).slice(0, 160),
	);
	const reaped = await gone(pid);
	verdict.check(
		"no child",
		reaped,
		`pid ${pid} ${reaped ? "left the process table" : "is STILL alive"}`,
	);
	verdict.check("reap set", liveChildren() === 0, `liveChildren() = ${liveChildren()}`);
	verdict.check(
		"list empty",
		plugin.commands.list().ids.length === 0,
		`list() ids = ${JSON.stringify(plugin.commands.list().ids)}`,
	);

	return verdict.report("e2e-pty");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`e2e-pty: FAIL  ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
