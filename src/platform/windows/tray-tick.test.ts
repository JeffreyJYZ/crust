/**
 * The tray click the Windows pump owes every slice.
 *
 * A Win32 message is not a JavaScript call: the hidden window's procedure records the row, and
 * `pollClick()` is the only path back. This suite proves the pump takes that path — without the tick
 * the fake records a click and nothing is relayed, which is the shape the brief called a tray that
 * silently does nothing.
 *
 * No notification area and no icon exist here: the symbol table is `notify-tray-fake.ts`, so what is
 * measured is the relay, never Win32.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createTrayPlugin } from "@/plugins/tray";
import { recordingContext } from "@/plugins/tray-fake.ts";
import { fakeBackend } from "./fake-backend.ts";
import { fakeNotifyTray } from "./notify-tray-fake.ts";
import { createPlatform } from "./platform-factory.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";
import { windowsTrayAdapter } from "./tray-adapter.ts";
import { pollTrayTick, setActiveWindowsTray } from "./tray-tick.ts";

const CONFIG = { appName: "crust-tray-tick" };

/** One adapter over one fake, with the plugin the registry would build and a page's event log. */
function built(clicks: number[]) {
	const fake = fakeNotifyTray({ clicks });
	const adapter = windowsTrayAdapter({ shim: () => fake });
	const plugin = createTrayPlugin(adapter);
	const { ctx, events } = recordingContext();
	plugin.commands.setMenu({ items: [{ label: "Open" }, { label: "Quit" }] }, ctx);
	return { adapter, fake, events };
}

afterEach(() => {
	setActiveWindowsTray(undefined);
	// `createPlatform` registers the instance in the process-wide registry, and this suite builds
	// one per test: leaving it set is what made a later file's `window` namespace answer over this
	// file's fake platform instead of its own.
	setActiveWindowsPlatform(undefined);
});

describe("the Windows pump drains the tray", () => {
	test("a recorded click is relayed on the next tick", () => {
		const { adapter, events } = built([1]);
		setActiveWindowsTray(adapter);
		const platform = createPlatform(CONFIG, fakeBackend());
		// `pump()` runs its first slice synchronously, so the relay lands before this returns.
		platform.pump(16);
		expect(events).toEqual([["tray:click", { index: 1, label: "Quit" }]]);
		expect(platform.ticks).toBeGreaterThan(0);
		platform.stopPump();
	});

	/**
	 * The regression this fixes: the same click, the same pump, and no relay — because nothing told
	 * the pump which adapter to poll. Wiring the slot afterwards is what makes the next tick relay it.
	 */
	test("without the slot a recorded click stays recorded", () => {
		setActiveWindowsTray(undefined);
		const { adapter, fake, events } = built([1]);
		const platform = createPlatform(CONFIG, fakeBackend());
		platform.pump(16);
		expect(fake.calls).not.toContain("click:1");
		expect(events).toEqual([]);
		setActiveWindowsTray(adapter);
		expect(pollTrayTick()).toBe(1);
		expect(events).toEqual([["tray:click", { index: 1, label: "Quit" }]]);
		platform.stopPump();
	});

	test("a tick with no click reads the C and relays nothing", () => {
		const { adapter, fake, events } = built([]);
		setActiveWindowsTray(adapter);
		const platform = createPlatform(CONFIG, fakeBackend());
		platform.pump(16);
		expect(fake.calls).toContain("click:-1");
		expect(events).toEqual([]);
		platform.stopPump();
	});

	test("a process with no tray pays one undefined check", () => {
		setActiveWindowsTray(undefined);
		expect(pollTrayTick()).toBe(-1);
	});
});
