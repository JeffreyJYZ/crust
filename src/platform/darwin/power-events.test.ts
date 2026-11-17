/**
 * The native proofs a plugin fake cannot give: the joined power C unit compiles with AppKit, the
 * runtime observer class really carries both notification selectors, and an unknown kind is refused.
 * Registering an observer touches no window, no sleep assertion and no user-visible state, so this is
 * safe to run on someone's laptop. The trampoline itself is driven with a fake unit below, without
 * compiling C or waiting for the machine to sleep.
 */

import { describe, expect, test } from "bun:test";
import { darwinPowerEvents, POWER_EVENT_KIND } from "./power-events.ts";
import { POWER_SYMBOL_NAMES, powerUnit, powerUnitStatus, type PowerUnit } from "./power-ffi.ts";

describe("power events C unit", () => {
	test("compiles with AppKit and exports every declared symbol", () => {
		const compiled = powerUnit();
		expect(powerUnitStatus()).toEqual({ available: true, reason: "compiled" });
		for (const name of POWER_SYMBOL_NAMES) {
			expect(typeof (compiled.symbols as unknown as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
		expect(Object.keys(compiled.symbols).sort()).toEqual([...POWER_SYMBOL_NAMES].sort());
	});

	test("the runtime observer class carries both notification callbacks", () => {
		expect(Number(powerUnit().symbols.crust_power_event_class_ready() ?? 0)).toBe(1);
	});

	test("an unknown notification kind is refused, not silently watched", () => {
		expect(Number(powerUnit().symbols.crust_power_watch(0) ?? -1)).toBe(0);
	});

	test("each supported kind registers an observer and a repeat reuses it", () => {
		const symbols = powerUnit().symbols;
		expect(Number(symbols.crust_power_watch(POWER_EVENT_KIND.sleep) ?? 0)).toBe(1);
		expect(Number(symbols.crust_power_watch(POWER_EVENT_KIND.sleep) ?? 0)).toBe(1);
		expect(Number(symbols.crust_power_watch(POWER_EVENT_KIND.lock) ?? 0)).toBe(1);
	});
});

/** A symbol table with only the three event calls, so no C unit is compiled for the trampoline test. */
function fakeUnit(watch: number): () => PowerUnit {
	const sinks: number[] = [];
	const watched: number[] = [];
	const unit = {
		symbols: {
			crust_power_set_sink: (pointer: number) => sinks.push(pointer),
			crust_power_watch: (kind: number) => {
				watched.push(kind);
				return watch;
			},
		},
	} as unknown as PowerUnit;
	(unit as unknown as { probe: unknown }).probe = { sinks, watched };
	return () => unit;
}

describe("darwin power event channel", () => {
	test("onSleep and onLock register the right kinds and keep a single sink", () => {
		const unit = fakeUnit(1);
		const events = darwinPowerEvents(unit);
		expect(events.onSleep(() => {})).toBe(true);
		expect(events.onLock(() => {})).toBe(true);
		const probe = (unit() as unknown as { probe: { sinks: number[]; watched: number[] } })
			.probe;
		expect(probe.watched).toEqual([POWER_EVENT_KIND.sleep, POWER_EVENT_KIND.lock]);
		expect(probe.sinks).toHaveLength(1);
	});

	test("a refused watch is reported, never a listener that never fires", () => {
		const events = darwinPowerEvents(fakeUnit(0));
		expect(events.onSleep(() => {})).toBe(false);
		expect(events.onLock(() => {})).toBe(false);
	});

	test("each kind dispatches only its own listener, and a re-arm replaces it", () => {
		const events = darwinPowerEvents(fakeUnit(1));
		const seen: string[] = [];
		events.onSleep(() => seen.push("first"));
		events.fire(POWER_EVENT_KIND.sleep);
		events.onSleep(() => seen.push("second"));
		events.fire(POWER_EVENT_KIND.sleep);
		events.fire(POWER_EVENT_KIND.lock);
		expect(seen).toEqual(["first", "second"]);
	});

	test("a throwing listener does not escape into the native callback", () => {
		const events = darwinPowerEvents(fakeUnit(1));
		events.onSleep(() => {
			throw new Error("the page's own handler failed");
		});
		expect(() => events.fire(POWER_EVENT_KIND.sleep)).not.toThrow();
	});
});
