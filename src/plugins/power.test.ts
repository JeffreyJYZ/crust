/**
 * `crust:power` proofs. The C unit is compiled and its read-only calls are exercised for real —
 * battery state and idle time touch no assertion and no dialog — while the assertion pair is proven
 * with a fake, because creating a real one on someone's laptop to watch it release is not a test.
 * The leak rule is the point: `sleepPrevent` then `sleepAllow` must leave nothing held, and a second
 * release must say so instead of erroring.
 */

import { describe, expect, test } from "bun:test";
import {
	darwinPowerAdapter,
	heldAssertion,
	POWER_SYMBOL_NAMES,
	powerUnit,
	powerUnitStatus,
} from "@/platform/darwin/power.ts";
import { isNotImplemented } from "@/plugins/define.ts";
import {
	createPowerPlugin,
	type PowerAdapter,
	POWER_COMMANDS,
	powerPlugin,
} from "@/plugins/power.ts";

interface Recorded {
	adapter: PowerAdapter;
	calls: string[];
	held: () => number;
}

/** A plain object that really holds a counter, so a release is measurable rather than asserted. */
function fake(overrides: Partial<PowerAdapter> = {}): Recorded {
	const calls: string[] = [];
	let held = 0;
	const adapter: PowerAdapter = {
		state: () => ({ onAc: true, batteryPercent: 87, lowPowerMode: false }),
		idleSeconds: () => 12.5,
		preventSleep: (reason) => {
			calls.push(`prevent:${reason}`);
			held += 1;
			return { ok: true, id: held, reason: "assertion held" };
		},
		allowSleep: () => {
			calls.push("allow");
			const released = held > 0;
			held = 0;
			return { ok: true, released, reason: released ? "assertion released" : "no assertion" };
		},
		...overrides,
	};
	return { adapter, calls, held: () => held };
}

async function thrown(run: () => Promise<unknown>): Promise<unknown> {
	try {
		await run();
		return undefined;
	} catch (error) {
		return error;
	}
}

describe("105_power.c", () => {
	test("compiles through cc(), links IOKit and CoreGraphics, exports the declared symbols", () => {
		const compiled = powerUnit();
		expect(Number(compiled.symbols.crust_power_abi())).toBe(1);
		expect(powerUnitStatus()).toEqual({ available: true, reason: "compiled" });
		for (const name of POWER_SYMBOL_NAMES) {
			expect(typeof (compiled.symbols as unknown as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
		expect(Object.keys(compiled.symbols).sort()).toEqual([...POWER_SYMBOL_NAMES].sort());
	});

	test("the unit holds no assertion, and releasing nothing is not an error", () => {
		const compiled = powerUnit();
		expect(heldAssertion()).toBe(0);
		expect(Number(compiled.symbols.crust_power_allow_sleep())).toBe(0);
		expect(String(compiled.symbols.crust_power_reason())).toContain("no assertion is held");
		expect(heldAssertion()).toBe(0);
	});

	test("a real read answers wall power, a percentage in range and a boolean low-power flag", () => {
		const state = darwinPowerAdapter().state();
		expect(typeof state.onAc).toBe("boolean");
		expect(
			state.batteryPercent === null ||
				(state.batteryPercent >= 0 && state.batteryPercent <= 100),
		).toBe(true);
		expect(typeof state.lowPowerMode).toBe("boolean");
		// No assertion is created by a read.
		expect(heldAssertion()).toBe(0);
	});

	test("idle time is a finite, non-negative number of seconds", () => {
		const seconds = darwinPowerAdapter().idleSeconds();
		expect(Number.isFinite(seconds)).toBe(true);
		expect(seconds).toBeGreaterThanOrEqual(0);
	});
});

describe("power plugin shape", () => {
	test("is named power and declares exactly the commands POWER_COMMANDS lists", () => {
		const plugin = createPowerPlugin(fake().adapter);
		expect(plugin.name).toBe("power");
		expect(Object.keys(plugin.commands).sort()).toEqual([...POWER_COMMANDS].sort());
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default export is the adapter-less one", () => {
		expect(powerPlugin.name).toBe("power");
		expect(Object.keys(powerPlugin.commands).sort()).toEqual([...POWER_COMMANDS].sort());
	});
});

describe("power commands with an adapter", () => {
	test("state and idleSeconds relay the adapter's own answer", async () => {
		const plugin = createPowerPlugin(fake().adapter);
		expect(await plugin.commands.state()).toEqual({
			ok: true,
			onAc: true,
			batteryPercent: 87,
			lowPowerMode: false,
		});
		expect(await plugin.commands.idleSeconds()).toEqual({ ok: true, seconds: 12.5 });
	});

	test("sleepPrevent then sleepAllow leaves no assertion held", async () => {
		const { adapter, calls, held } = fake();
		const plugin = createPowerPlugin(adapter);
		expect(await plugin.commands.sleepPrevent({ reason: "crust: a long export" })).toEqual({
			ok: true,
			id: 1,
		});
		expect(held()).toBe(1);
		expect(await plugin.commands.sleepAllow()).toEqual({ ok: true, released: true });
		expect(held()).toBe(0);
		expect(calls).toEqual(["prevent:crust: a long export", "allow"]);
		// A second release says so, rather than pretending to release a second time.
		expect(await plugin.commands.sleepAllow()).toEqual({ ok: true, released: false });
	});

	test("a second sleepPrevent reuses the held assertion instead of leaking the first id", async () => {
		const { adapter, calls, held } = fake();
		const plugin = createPowerPlugin(adapter);
		const first = await plugin.commands.sleepPrevent({ reason: "one" });
		const second = await plugin.commands.sleepPrevent({ reason: "two" });
		expect(second).toEqual(first);
		// Only one native assertion exists: the shim's single id was never overwritten.
		expect(held()).toBe(1);
		expect(calls).toEqual(["prevent:one"]);
		expect(await plugin.commands.sleepAllow()).toEqual({ ok: true, released: true });
		expect(held()).toBe(0);
		expect(calls).toEqual(["prevent:one", "allow"]);
	});

	test("an empty reason is bad-request before any assertion is attempted", async () => {
		const { adapter, calls } = fake();
		const error = await thrown(() =>
			createPowerPlugin(adapter).commands.sleepPrevent({ reason: "" }),
		);
		expect((error as { code?: string }).code).toBe("bad-request");
		expect(calls).toEqual([]);
	});

	test("a refused assertion is a typed failure carrying the C reason", async () => {
		const { adapter } = fake({
			preventSleep: () => ({
				ok: false,
				id: 0,
				reason: "IOPMAssertionCreateWithName refused",
			}),
		});
		expect(await createPowerPlugin(adapter).commands.sleepPrevent({ reason: "x" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "IOPMAssertionCreateWithName refused",
		});
	});
});

describe("power refusals", () => {
	test("an absent adapter is not-implemented, naming IOKit for the pull commands", async () => {
		for (const command of ["state", "idleSeconds", "sleepPrevent", "sleepAllow"] as const) {
			const answer = await (powerPlugin.commands[command] as () => Promise<unknown>)();
			expect(isNotImplemented(answer)).toBe(true);
			expect(answer).toMatchObject({ requires: "IOPSCopyPowerSourcesInfo" });
		}
	});

	test("the real adapter releases nothing when nothing is held", () => {
		expect(darwinPowerAdapter().allowSleep()).toEqual({
			ok: true,
			released: false,
			reason: "no assertion is held",
		});
		expect(heldAssertion()).toBe(0);
	});
});
