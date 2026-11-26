#!/usr/bin/env bun
/**
 * Two-process harness for the reported state, with no human and no ⌃⌘F. A's accessory window joins
 * whatever Space exists when it is created; B is started afterwards and goes fullscreen, taking a new
 * Space and leaving A's window on the previous one. B is the only process that activates itself.
 *
 * HEADS-UP: B takes the screen for a few seconds. Both processes restore the operator's frontmost
 * app before this script exits — on success, failure, timeout and SIGINT. Nothing here fakes the
 * state: if B cannot go fullscreen, or A's window stays on the active Space, the only answer is
 * `unreachable` with a reason and exit 2.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { S } from "@/platform/darwin/objc.ts";
import {
	QUIT,
	READY,
	READY_TIMEOUT_MS,
	QUIT_TIMEOUT_MS,
	TAKER,
	TOKEN,
	readReady,
	waitFor,
} from "./capture-offscreen/protocol.ts";
import { createSubject, state, threeCaptures } from "./capture-offscreen/subject.ts";
import {
	captureFrontmost,
	clearSurvivors,
	guardFocus,
	restoreFocus,
	survivorsOf,
} from "./e2e-harness.ts";

const ROOT = join(import.meta.dir, "..");

function line(value: unknown): void {
	console.log(JSON.stringify(value));
}

function unreachable(reason: string): number {
	line({ unreachable: reason });
	return 2;
}

/** B's diagnostics go to the operator's stderr, never into A's one JSON line. */
async function forward(stream: number | ReadableStream<Uint8Array> | undefined): Promise<void> {
	if (typeof stream !== "object" || stream === null) return;
	try {
		const text = await new Response(stream).text();
		if (text) process.stderr.write(text);
	} catch {
		// The child closed its pipe.
	}
}

async function main(): Promise<number> {
	if (process.platform !== "darwin") return unreachable(`no WKWebView on ${process.platform}`);
	const token = `crust-offscreen-${Date.now()}-${process.pid}`;
	const dir = mkdtempSync(join(tmpdir(), token));
	const readyPath = join(dir, "ready.json");
	const quitPath = join(dir, "quit");
	const named = process.env[TAKER];
	const taker = named
		? resolve(named)
		: join(import.meta.dir, "capture-offscreen/space-taker.ts");
	const frontmost = guardFocus();
	let child: ReturnType<typeof Bun.spawn> | undefined;
	const killChild = (): void => {
		if (!child) return;
		try {
			process.kill(child.pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	};
	process.on("SIGINT", killChild);
	process.on("SIGTERM", killChild);
	await clearSurvivors(token);
	const before = (await survivorsOf(token, 0)).length;
	let subject: Awaited<ReturnType<typeof createSubject>> | undefined;
	try {
		subject = await createSubject();
		const { web, win } = subject;
		child = Bun.spawn({
			cmd: ["bun", "run", taker, dir],
			cwd: ROOT,
			env: { ...process.env, [READY]: readyPath, [QUIT]: quitPath, [TOKEN]: token },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const spawned = child;
		void forward(spawned.stdout);
		void forward(spawned.stderr);
		const ready = await waitFor(() => readReady(readyPath), READY_TIMEOUT_MS);
		if (!ready) return unreachable(`space taker sent no status within ${READY_TIMEOUT_MS}ms`);
		if (ready.status === "unreachable") return unreachable(ready.reason);
		const during = await captureFrontmost();
		// B's own fullscreen read can land before AppKit settles A's Space; poll, never guess.
		await waitFor(() => (S.b0(win, "isOnActiveSpace") ? undefined : true), 2000);
		const a = state(win);
		if (a.onActiveSpace)
			return unreachable(
				`probe window still on the active Space; B fullscreen=${ready.window.onActiveSpace}`,
			);

		const shots = await threeCaptures(web);
		writeFileSync(quitPath, "quit\n");
		const exited = await Promise.race([
			spawned.exited.then(() => true),
			Bun.sleep(QUIT_TIMEOUT_MS).then(() => false),
		]);
		if (!exited) killChild();
		await restoreFocus(frontmost);
		await Bun.sleep(400);
		const after = await captureFrontmost();
		const survivors = (await survivorsOf(token, 2000)).length;
		line({
			a,
			b: ready.window,
			...shots,
			screen: {
				before: frontmost ?? "unknown",
				during: during ?? "unknown",
				after: after ?? "unknown",
			},
			survivors,
		});
		return survivors > before ? 1 : 0;
	} catch (thrown) {
		return unreachable(thrown instanceof Error ? thrown.message : String(thrown));
	} finally {
		killChild();
		if (child) await Promise.race([child.exited, Bun.sleep(2000)]);
		if (subject) {
			try {
				S.v0(subject.win, "close");
			} catch {
				// Already gone.
			}
			subject.platform.stopPump();
			subject.stop();
		}
		await restoreFocus(frontmost);
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// Temp scratch.
		}
		process.removeListener("SIGINT", killChild);
		process.removeListener("SIGTERM", killChild);
	}
}

main()
	.then((code) => process.exit(code))
	.catch((thrown: unknown) => {
		line({ unreachable: thrown instanceof Error ? thrown.message : String(thrown) });
		process.exit(2);
	});
