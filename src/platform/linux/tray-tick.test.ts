/**
 * The tray click the Linux pump owes every slice.
 *
 * A GObject `activate` signal is not a JavaScript call: GTK records the row, and `pollClick()` is the
 * only path back. This suite proves the pump takes that path — without the tick the fake records a
 * click and nothing is relayed, which is the shape the brief called a tray that silently does nothing.
 *
 * No status icon and no menu exist here: the symbol table is `notify-tray-fake.ts` and the platform
 * runs over the window fake, so what is measured is the relay, never GTK.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createTrayPlugin } from "@/plugins/tray";
import { recordingContext } from "@/plugins/tray-fake.ts";
import { fakeNotifyTray } from "./notify-tray-fake.ts";
import { linuxTrayAdapter } from "./tray-adapter.ts";
import { pollTrayTick, setActiveLinuxTray } from "./tray-tick.ts";
import { openFake } from "./window-fake.ts";

/** One adapter over one fake, with the plugin the registry would build and a page's event log. */
function built(clicks: number[]) {
	const fake = fakeNotifyTray({ clicks });
	const adapter = linuxTrayAdapter({ shim: () => fake });
	const plugin = createTrayPlugin(adapter);
	const { ctx, events } = recordingContext();
	plugin.commands.setMenu({ items: [{ label: "Open" }, { label: "Quit" }] }, ctx);
	return { adapter, fake, events };
}

afterEach(() => {
	setActiveLinuxTray(undefined);
});

describe("the Linux pump drains the tray", () => {
	test("a recorded click is relayed on the next tick", async () => {
		const { adapter, events } = built([1]);
		setActiveLinuxTray(adapter);
		const { platform } = await openFake();
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
	test("without the slot a recorded click stays recorded", async () => {
		setActiveLinuxTray(undefined);
		const { adapter, fake, events } = built([1]);
		const { platform } = await openFake();
		platform.pump(16);
		expect(fake.calls).not.toContain("click:1");
		expect(events).toEqual([]);
		setActiveLinuxTray(adapter);
		expect(pollTrayTick()).toBe(1);
		expect(events).toEqual([["tray:click", { index: 1, label: "Quit" }]]);
		platform.stopPump();
	});

	test("a tick with no click reads the C and relays nothing", async () => {
		const { adapter, fake, events } = built([]);
		setActiveLinuxTray(adapter);
		const { platform } = await openFake();
		platform.pump(16);
		expect(fake.calls).toContain("click:-1");
		expect(events).toEqual([]);
		platform.stopPump();
	});

	test("a process with no tray pays one undefined check", () => {
		setActiveLinuxTray(undefined);
		expect(pollTrayTick()).toBe(-1);
	});
});
