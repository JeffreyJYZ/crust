/**
 * Parity, not a second capture path: `browser.capture` hands the surface's own `WKWebView` to
 * `takeSnapshot`, the same unit `window.capture` calls, so a state that unit cannot photograph — a
 * window off the active Space, ordered out, never drawn — fails identically on both surfaces.
 *
 * No WebKit, no window and no activation: the C half is a fake `SnapshotShim`, so the two adapters
 * are compared on the answer they give for one state, which is the only difference that matters
 * when a fix lands in that unit.
 */

import { describe, expect, test } from "bun:test";

import { FakeNative, ports } from "./browser-adapter-fixture.ts";
import { readCommands } from "./browser-read-commands.ts";
import { type Surface, SurfaceStore } from "./browser-surface.ts";
import {
	SNAPSHOT_STATUS,
	type SnapshotShim,
	snapshotStartReason,
	takeSnapshot,
} from "./snapshot.ts";
import { windowCaptureAdapter } from "./window-capture-adapter.ts";

const WEB = 0x400;

/** The unit refusing to start a render, whatever the reason: no picture is produced. */
function refusesShim(taken: number[] = []): SnapshotShim {
	return {
		available: () => true,
		take: (view) => {
			taken.push(view);
			return SNAPSHOT_STATUS.unavailable;
		},
		read: () => {
			throw new Error("a refusing shim has no bytes");
		},
		setChannel: () => {},
	};
}

/** The unit starting a render whose completion answers "nothing was drawn". */
function drawsNothingShim(): SnapshotShim {
	let listener: ((id: number, ok: boolean) => void) | undefined;
	return {
		available: () => true,
		take: (_view, id) => {
			listener?.(id, false);
			return SNAPSHOT_STATUS.started;
		},
		read: () => {
			throw new Error("a blank render has no bytes");
		},
		setChannel: (onAnswer) => {
			listener = onAnswer;
		},
	};
}

function surfaces(): SurfaceStore {
	const store = new SurfaceStore();
	const surface: Surface = {
		label: "docs",
		web: WEB,
		view: 0x100,
		owner: "main",
	};
	store.set(surface);
	return store;
}

/** The browser surface's answer for a state, as its message rather than the picture. */
async function browserMessage(shim: SnapshotShim): Promise<string> {
	const browserPorts = {
		...ports(new FakeNative()),
		snapshot: (web: number) => takeSnapshot(web, shim),
	};
	const answer = await readCommands(surfaces(), () => browserPorts).capture(
		"docs",
	);
	if (answer.ok) throw new Error("browser.capture answered a picture");
	return answer.message;
}

/** The app webview's answer for the same state. */
async function windowMessage(shim: SnapshotShim): Promise<string> {
	const capture = windowCaptureAdapter(() => WEB, shim).capture;
	if (capture === undefined)
		throw new Error("the window adapter has no capture");
	try {
		await capture("main");
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("window.capture answered a picture");
}

describe("browser.capture is the window.capture snapshot unit", () => {
	test("a render the unit refuses fails with the same named reason on both", async () => {
		const browser = await browserMessage(refusesShim());
		expect(browser).toBe(await windowMessage(refusesShim()));
		expect(browser).toContain(
			snapshotStartReason(SNAPSHOT_STATUS.unavailable),
		);
	});

	test("a render that draws nothing fails the same on both", async () => {
		const browser = await browserMessage(drawsNothingShim());
		expect(browser).toBe(await windowMessage(drawsNothingShim()));
		expect(browser).toContain("rendered nothing");
	});

	test("browser.capture renders the surface's own webview, not the app's", async () => {
		const taken: number[] = [];
		await browserMessage(refusesShim(taken));
		expect(taken).toEqual([WEB]);
	});
});
