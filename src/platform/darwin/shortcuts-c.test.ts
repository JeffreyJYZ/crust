/**
 * The Carbon arm of unregister, driven without Carbon: every extern `93_shortcuts.c` declares is
 * replaced by a local stub that reports a controllable failure, so a refused `UnregisterEventHotKey`
 * is exercised as real C rather than read off the source. No hot key, no window, no focus.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cc, FFIType } from "bun:ffi";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import source from "./shim/93_shortcuts.c" with { type: "text" };

const dir = mkdtempSync(join(tmpdir(), "crust-shortcuts-c-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every symbol the shim imports resolves to a stub in this unit, so cc() needs no Carbon. The
// crust_test_* helpers read the shim's own statics from the same translation unit.
const stubs = `
static long crust_unregister_status = 0;
int crust_test_refuse(long status) { crust_unregister_status = status; return 0; }
int crust_test_live(int id) {
	for (int i = 0; i < SHORTCUT_MAX; i++)
		if (shortcut_refs[i] && (int)shortcut_ids[i] == id) return 1;
	return 0;
}
void *GetApplicationEventTarget(void) { return (void *)0x10; }
long InstallEventHandler(void *t, void *h, unsigned long n, const void *l, void *u, void **r) {
	if (r) *r = (void *)0x20;
	return 0;
}
long RegisterEventHotKey(unsigned int k, unsigned int m, unsigned long long id, void *t,
                         unsigned int o, void **r) {
	if (r) *r = (void *)0x30;
	return 0;
}
long UnregisterEventHotKey(void *r) { return crust_unregister_status; }
long GetEventParameter(void *e, unsigned int n, unsigned int t, void *ot, unsigned long s,
                       unsigned long *os, void *d) { return -1; }
long CreateEvent(void *a, unsigned int c, unsigned int k, double w, unsigned int f, void **o) {
	return -1;
}
long SetEventParameter(void *e, unsigned int n, unsigned int t, unsigned long s, const void *d) {
	return -1;
}
long SendEventToEventTarget(void *e, void *t) { return 0; }
void ReleaseEvent(void *e) {}
`;

const I32 = FFIType.i32;
const file = join(dir, "unit.c");
writeFileSync(file, `${source}\n${stubs}\n`);

interface Unit {
	symbols: {
		shortcut_install: (imp: number) => number;
		shortcut_register: (key: number, modifiers: number) => number;
		shortcut_unregister: (id: number) => number;
		shortcut_unregister_all: () => number;
		crust_test_refuse: (status: number) => number;
		crust_test_live: (id: number) => number;
	};
}

function fresh(): Unit {
	const unit = cc({
		source: file,
		symbols: {
			shortcut_install: { args: ["ptr"], returns: I32 },
			shortcut_register: { args: [I32, I32], returns: I32 },
			shortcut_unregister: { args: [I32], returns: I32 },
			shortcut_unregister_all: { args: [], returns: I32 },
			crust_test_refuse: { args: [I32], returns: I32 },
			crust_test_live: { args: [I32], returns: I32 },
		},
	}) as unknown as Unit;
	expect(unit.symbols.shortcut_install(0x1234)).toBe(1);
	return unit;
}

describe("the Carbon unregister arm", () => {
	test("a refused removal keeps the ref, so a retry reaches the OS again", () => {
		const unit = fresh();
		const id = unit.symbols.shortcut_register(40, 0);
		expect(id).toBeGreaterThan(0);

		unit.symbols.crust_test_refuse(-1);
		expect(unit.symbols.shortcut_unregister(id)).toBe(0);
		expect(unit.symbols.crust_test_live(id)).toBe(1);
		unit.symbols.crust_test_refuse(0);
		expect(unit.symbols.shortcut_unregister(id)).toBe(1);
		expect(unit.symbols.crust_test_live(id)).toBe(0);
		expect(unit.symbols.shortcut_unregister(id)).toBe(0);
	});

	test("unregisterAll keeps slots whose OS call refused", () => {
		const unit = fresh();
		const first = unit.symbols.shortcut_register(40, 0);
		const second = unit.symbols.shortcut_register(41, 0);

		unit.symbols.crust_test_refuse(-1);
		expect(unit.symbols.shortcut_unregister_all()).toBe(0);
		expect(unit.symbols.crust_test_live(first)).toBe(1);
		expect(unit.symbols.crust_test_live(second)).toBe(1);
		unit.symbols.crust_test_refuse(0);
		expect(unit.symbols.shortcut_unregister_all()).toBe(2);
		expect(unit.symbols.crust_test_live(first)).toBe(0);
		expect(unit.symbols.crust_test_live(second)).toBe(0);
	});
});
