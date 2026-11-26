#!/usr/bin/env bun
/**
 * Process B: the only process allowed to activate. It builds a plain fullscreen-primary window,
 * activates itself so AppKit accepts the transition, flips that window fullscreen, reports its state
 * to A, then waits for A's quit file. On every path it leaves fullscreen, closes the window and
 * restores the app it found at startup, so the operator gets the desktop back.
 */
import { existsSync, writeFileSync } from "node:fs";
import { shim } from "@/platform/darwin/index.ts";
import { cls, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { guardFocus, restoreFocus } from "../e2e-harness.ts";
import { QUIT, READY, type Ready, TAKER_TIMEOUT_MS, waitFor } from "./protocol.ts";

const APP = "crust-offscreen-taker";
const STYLE = 15; // titled | closable | miniaturizable | resizable
const COLLECTION = 130; // moveToActiveSpace | fullScreenPrimary; never the 256 auxiliary bit
const LIFETIME_MS = 90_000;

function report(path: string, value: Ready): void {
	try {
		writeFileSync(path, JSON.stringify(value));
	} catch {
		// A times out with its own reason if the file cannot be written.
	}
}

/** Keep `platform.start()`'s two diagnostics off stdout; B's readiness is a file, not a line. */
async function quietStart(platform: DarwinPlatform): Promise<void> {
	const log = console.log;
	console.log = (...args: unknown[]) => process.stderr.write(`${args.join(" ")}\n`);
	try {
		await platform.start();
	} finally {
		console.log = log;
	}
}

async function main(): Promise<number> {
	const readyPath = process.env[READY];
	const quitPath = process.env[QUIT];
	if (!readyPath || !quitPath) {
		process.stderr.write("space-taker: missing ready/quit paths\n");
		return 2;
	}
	const frontmost = guardFocus();
	let platform: DarwinPlatform | undefined;
	let win = 0;
	let fullscreen = false;
	try {
		platform = new DarwinPlatform({ appName: APP, activate: "never" });
		await quietStart(platform);
		const app = S.p0(cls("NSApplication"), "sharedApplication", true);
		const symbols = shim().symbols;
		win = Number(symbols.shim_window_new(40, 40, 600, 400, BigInt(STYLE), 2n, 0) ?? 0);
		if (!win) throw new Error("shim_window_new returned null");
		S.vq1(win, "setCollectionBehavior:", COLLECTION);
		S.v0(win, "orderFrontRegardless");
		platform.pump(16);
		// The harness's one activation: without it AppKit refuses the fullscreen transition.
		S.vb1(app, "activateIgnoringOtherApps:", 1);
		symbols.shim_window_toggle_fullscreen(win);
		const started = Date.now();
		const became = await waitFor(
			() => (Number(symbols.shim_window_is_fullscreen(win) ?? 0) === 1 ? true : undefined),
			TAKER_TIMEOUT_MS,
		);
		if (!became) throw new Error(`no fullscreen transition within ${TAKER_TIMEOUT_MS}ms`);
		fullscreen = true;
		report(readyPath, {
			status: "fullscreen",
			window: {
				onActiveSpace: S.b0(win, "isOnActiveSpace"),
				occlusionState: S.q0(win, "occlusionState"),
			},
			styleMask: S.q0(win, "styleMask"),
			ms: Date.now() - started,
		});
		// Hold the Space until A has taken its captures; bounded, never a fixed sleep.
		await waitFor(() => (existsSync(quitPath) ? true : undefined), LIFETIME_MS);
		return 0;
	} catch (thrown) {
		const reason = thrown instanceof Error ? thrown.message : String(thrown);
		report(readyPath, { status: "unreachable", reason });
		return 2;
	} finally {
		if (win && fullscreen) {
			try {
				shim().symbols.shim_window_toggle_fullscreen(win);
			} catch {
				// Process exit destroys the fullscreen Space in any case.
			}
		}
		if (win) {
			try {
				S.v0(win, "close");
			} catch {
				// Already gone.
			}
		}
		platform?.stopPump();
		await restoreFocus(frontmost);
	}
}

main()
	.then((code) => process.exit(code))
	.catch((thrown: unknown) => {
		process.stderr.write(
			`space-taker: ${thrown instanceof Error ? thrown.message : String(thrown)}\n`,
		);
		process.exit(2);
	});
