/**
 * `crust:dock` command proofs, all against a fake adapter: what each command answers, how a
 * `NSCriticalRequest` is chosen, and that every refusal is a typed answer rather than a throw — an
 * adapter that throws is the one thing that must not reach a page as a rejected invoke.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented } from "@/plugins/define.ts";
import { createDockPlugin, type DockAdapter, dockPlugin } from "@/plugins/dock.ts";
import { fake, thrown } from "./dock-fake.ts";

describe("dock commands with an adapter", () => {
	test("badge sets, and an empty label clears it", async () => {
		const { adapter, calls } = fake();
		const plugin = createDockPlugin(adapter);
		expect(await plugin.commands.badge({ label: "3" })).toEqual({
			ok: true,
			label: "3",
			cleared: false,
		});
		expect(await plugin.commands.badge({ label: "" })).toEqual({
			ok: true,
			label: "",
			cleared: true,
		});
		expect(calls).toEqual(["setBadge:3", "setBadge:"]);
	});

	test("a cleared badge reads back empty, which is what AppKit reports", async () => {
		let shown = "3";
		const adapter: DockAdapter = {
			setBadge: (label) => {
				shown = label;
				return { ok: true, reason: label.length === 0 ? "badge cleared" : "badge set" };
			},
			badgeLabel: () => shown,
			bounce: () => ({ ok: true, request: 1, reason: "bounced" }),
			setProgress: () => ({ ok: true, reason: "progress set" }),
		};
		const plugin = createDockPlugin(adapter);
		expect(await plugin.commands.badge({ label: "" })).toEqual({
			ok: true,
			label: "",
			cleared: true,
		});
		expect(await plugin.commands.badgeLabel()).toEqual({ ok: true, label: "" });
	});

	test("badgeLabel relays what the tile shows", async () => {
		const plugin = createDockPlugin(fake().adapter);
		expect(await plugin.commands.badgeLabel()).toEqual({ ok: true, label: "3" });
	});

	test("bounce maps critical to the request it asked for", async () => {
		const { adapter, calls } = fake();
		const plugin = createDockPlugin(adapter);
		expect(await plugin.commands.bounce({})).toEqual({
			ok: true,
			critical: false,
			request: 6,
		});
		expect(await plugin.commands.bounce({ critical: true })).toEqual({
			ok: true,
			critical: true,
			request: 7,
		});
		expect(calls).toEqual(["bounce:false", "bounce:true"]);
	});

	test("progress relays a fraction and refuses one outside 0..1", async () => {
		const { adapter, calls } = fake();
		const plugin = createDockPlugin(adapter);
		expect(await plugin.commands.progress({ value: 0.5 })).toEqual({ ok: true, value: 0.5 });
		expect(calls).toEqual(["setProgress:0.5"]);
		const error = await thrown(() => plugin.commands.progress({ value: 2 }));
		expect(error).toBeInstanceOf(Error);
		expect(calls).toEqual(["setProgress:0.5"]);
	});
});

describe("dock refusals", () => {
	test("an absent adapter is not-implemented, naming NSDockTile", async () => {
		const answer = await dockPlugin.commands.badge({ label: "3" });
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "NSDockTile" });
	});

	test("a non-string label is bad-request, not a silent coercion", async () => {
		const plugin = createDockPlugin(fake().adapter);
		const error = await thrown(() => plugin.commands.badge({} as never));
		expect((error as { code?: string }).code).toBe("bad-request");
	});

	test("a refused badge is a typed failure carrying the C reason", async () => {
		const { adapter } = fake({
			setBadge: () => ({ ok: false, reason: "NSApplication has no dock tile" }),
		});
		const answer = await createDockPlugin(adapter).commands.badge({ label: "3" });
		expect(answer).toEqual({
			ok: false,
			code: "handler-error",
			message: "NSApplication has no dock tile",
		});
	});

	test("a badgeLabel the native unit never read refuses instead of reporting no badge", async () => {
		const adapter: DockAdapter = {
			setBadge: () => ({ ok: false, reason: "the dock C unit did not compile" }),
			// What darwinDockAdapter returns when compiled() fails: an empty label that is
			// indistinguishable from a cleared tile unless the plugin proves the tile is reachable.
			badgeLabel: () => "",
			bounce: () => ({ ok: true, request: 1, reason: "bounced" }),
			setProgress: () => ({ ok: true, reason: "progress set" }),
		};
		const answer = await createDockPlugin(adapter).commands.badgeLabel();
		expect(answer).toEqual({
			ok: false,
			code: "handler-error",
			message: "the dock C unit did not compile",
		});
	});

	test("a progress bar that could not be installed names the selector it needed", async () => {
		const { adapter } = fake({
			setProgress: () => ({ ok: false, reason: "NSProgressIndicator is not reachable" }),
		});
		const answer = await createDockPlugin(adapter).commands.progress({ value: 0.4 });
		expect(isNotImplemented(answer)).toBe(true);
		expect(answer).toMatchObject({ requires: "-[NSDockTile setContentView:]" });
		expect((answer as { message: string }).message).toContain("NSProgressIndicator");
	});
});
