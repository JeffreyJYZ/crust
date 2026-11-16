/**
 * Two behaviours that are invisible until they cost a run: a vtable entry that is not code must be
 * refused rather than jumped to, and a wait must be bounded by a deadline rather than by iterations of
 * `Sleep(1)`.
 *
 * `Sleep(1)` rounds up to the ~15.6 ms timer tick on Windows, so `maxMs = 5000` read as an iteration
 * count was ~48 s — which is why one probe run took 95.5 s. And a probe that jumps to
 * `0xffffffffffffffff` reports exactly one defect, which is how seven of them each needed their own run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lf, readShimPart, readShimSource, SHIM_PART_NAMES } from "./shim-source.ts";

const source = readShimSource();
const guard = readShimPart("14_guard.c");
const com = readShimPart("30_com.c");
const stages = lf(
	readFileSync(
		join(import.meta.dir, "..", "..", "..", "scripts", "windows", "stages.ts"),
		"utf8",
	),
);

describe("the vtable guard", () => {
	test("is its own part, before anything that calls a slot", () => {
		const guardAt = SHIM_PART_NAMES.indexOf("14_guard.c");
		expect(guardAt).toBeGreaterThan(SHIM_PART_NAMES.indexOf("12_win32.c"));
		expect(guardAt).toBeLessThan(SHIM_PART_NAMES.indexOf("20_class.c"));
	});

	/** 0, `(void *)-1` and memory that is not committed executable are three ways to jump to nowhere. */
	test("refuses a null, a -1 and a non-executable address, and records the slot", () => {
		expect(guard).toContain("if (!address || address == (const void *)-1) return 0;");
		expect(guard).toContain("(*(unsigned int *)((const char *)info + 32) & 0x1000u) == 0");
		expect(guard).toContain("(*(unsigned int *)((const char *)info + 36) & 0xF0u) == 0");
		expect(guard).toContain("g_bad_slot = index;");
		expect(source).toContain("SHIM_BIND(g_kernel32, VirtualQuery);");
	});

	test("every vtable call site checks its own slot first", () => {
		// One per call: AddRef 1, environment 3, controller 25, put_Bounds 6, Close 24, Navigate 5.
		expect(source.match(/shim_slot_ok\(vt, /g)?.length).toBe(6);
		for (const slot of [
			"SHIM_SLOT_ENV_CREATE_CONTROLLER",
			"SHIM_SLOT_CONTROLLER_WEBVIEW",
			"SHIM_SLOT_CONTROLLER_PUT_BOUNDS",
			"SHIM_SLOT_CONTROLLER_CLOSE",
			"SHIM_SLOT_WEBVIEW_NAVIGATE",
		]) {
			expect(source).toContain(`if (!shim_slot_ok(vt, ${slot}))`);
		}
	});
});

describe("the wait is bounded by a deadline", () => {
	test("handler_wait measures time, not iterations", () => {
		expect(com).toContain("GetTickCount64");
		expect(com).not.toContain("int waited = 0;");
		expect(com).toContain("GetTickCount64() >= deadline");
		expect(source).toContain("SHIM_BIND(g_kernel32, GetTickCount64);");
	});
});

describe("the probe reports every defect in one run", () => {
	/** `0x802A000C` arrives zero-extended as `2150236172`, which a plain `< 0` scores as a pass. */
	test("scores an HRESULT by its low 32 bits, and prints both forms", () => {
		expect(stages).toContain("(value | 0) < 0");
		expect(stages).toContain("ok ${value} (${hex(value)})");
	});

	/** An absence has to be visible: a skipped stage prints why, rather than vanishing. */
	test("prints why the rest of the run is missing", () => {
		expect(stages).toContain("function skipped(");
		expect(stages).toMatch(/skipped\("no window/);
		expect(stages).toMatch(/skipped\("no controller/);
		expect(stages).toMatch(/skipped\("no ICoreWebView2/);
	});
});

describe("an unreadable object is a verdict, not a fault", () => {
	/**
	 * The panic was the dereference *before* the call: a `ctrl` of `(void *)-1` faults on
	 * `*(void ***)ctrl`, reading `0xFFFFFFFFFFFFFFFF`. So readability is asked first, and the four
	 * answers are distinct: fine, object unreadable, first field unreadable, entry not code.
	 */
	test("readability is a separate question from callability", () => {
		expect(guard).toContain("int shim_is_readable(const void *address)");
		expect(guard).toContain("int shim_is_code(const void *address)");
		// MEM_COMMIT required; PAGE_NOACCESS (0x01) and PAGE_GUARD (0x100) refused.
		expect(guard).toContain("& 0x1000u) == 0) return 0; /* MEM_COMMIT */");
		expect(guard).toContain("& 0x101u) return 0; /* NOACCESS | GUARD */");
	});

	test("the four verdicts have four values", () => {
		expect(guard).toContain("#define SHIM_OBJ_OK 0");
		expect(guard).toContain("#define SHIM_OBJ_UNREADABLE 1");
		expect(guard).toContain("#define SHIM_OBJ_VTBL_UNREADABLE 2");
		expect(guard).toContain("#define SHIM_OBJ_SLOT_NOT_CODE 3");
		// `(void *)-1` and a null are refused before VirtualQuery is even asked.
		expect(guard).toContain("if (!address || address == (const void *)-1) return 0;");
	});

	/** The regression that produced the panic: a site that dereferences the object itself. */
	test("no call site dereferences an object directly", () => {
		const outside = SHIM_PART_NAMES.filter((name) => name !== "14_guard.c")
			.map(readShimPart)
			.join("\n");
		// Taking a vtable from an object is the guard's job and nowhere else.
		expect(outside).not.toContain("*(void ***)");
		// The only `*(void **)` left reads our own static handler, never a caller's pointer.
		for (const line of outside.split("\n").filter((text) => text.includes("*(void **)"))) {
			expect(line).toContain("&g_env_handler");
		}
		// Nine call sites plus the definition in the guard.
		expect(source.match(/shim_object_vtbl\(/g)?.length).toBe(11);
	});
});

describe("the store is compared with the readback", () => {
	/**
	 * `handler_invoke` writes `h->result = created`. Recording `created` separately, and keeping it across
	 * `handler_init`, separates "WebView2 handed us a non-object" from "the field was overwritten after
	 * the store" — two defects with different fixes.
	 */
	test("the callback keeps what it was handed, across handler_init", () => {
		expect(com).toContain("void *created;");
		expect(com).toContain("h->created = created;");
		const init = com.slice(com.indexOf("void handler_init(shim_handler *h, int step) {"));
		const body = init.slice(0, init.indexOf("\n}"));
		expect(body).not.toContain("h->created =");
		expect(source).toContain("void *shim_handler_created(int step)");
	});

	test("the first bytes of an object can be dumped", () => {
		expect(source).toContain("int shim_object_bytes(void *obj, void *out, int words)");
		expect(source).toContain("if (!dst || words <= 0 || !shim_is_readable(obj)) return 0;");
	});
});

describe("the apartment call passes two real out-params", () => {
	/**
	 * `CoGetApartmentType(&type, 0)` answered `E_INVALIDARG` (0x80070057) — the qualifier is not optional
	 * — and the probe read that as "not initialised" for two runs.
	 */
	test("the qualifier is a variable, not a null", () => {
		expect(source).toContain("CoGetApartmentType(&type, &qualifier)");
		expect(source).not.toContain("CoGetApartmentType(&type, 0)");
		expect(source).toContain("int shim_apartment_qualifier(void)");
	});
});

describe("the failure message names what actually failed", () => {
	/**
	 * It said "the runtime is installed but did not answer" while `CreateCoreWebView2Controller` and its
	 * callback both returned S_OK and the object they produced had no readable vtable. A message that
	 * blames the runtime for a bad object sends the next person to the wrong fix.
	 */
	test("it reports the object state, not a runtime that never answered", () => {
		const open = lf(readFileSync(join(import.meta.dir, "window-open.ts"), "utf8"));
		expect(open).not.toContain("did not answer");
		expect(open).toContain("objectStateName(state)");
		expect(open).toContain("shim.shim_object_state(shim.shim_controller_addr())");
		expect(open).toContain("ctrl_from");
	});
});
