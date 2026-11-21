/**
 * The surface table, **executed**. `41_surfaces.c` calls nothing outside itself and uses no prelude
 * typedef, so bun:ffi's `cc()` builds it on macOS too — which makes "two handles keep separate state"
 * a measurement here rather than a sentence about C nobody ran. The same file is compiled into the
 * window shim, so what passes below is the code the Windows runner executes.
 *
 * What only a Windows runner can still prove is the other half: that `put_Bounds` and `Navigate` reach
 * the controller and webview a handle names. That is `scripts/windows/surfaces.ts` in `gate (windows)`.
 */
import { describe, expect, test } from "bun:test";
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShimPart, SHIM_PART_NAMES } from "./shim-source.ts";

const P = FFIType.ptr;
const I32 = FFIType.i32;

/** The part as the shim compiles it, materialised for TinyCC. */
function sourcePath(): string {
	const source = readShimPart("41_surfaces.c");
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-surfaces-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, source);
	return path;
}

function unit() {
	return cc({
		source: sourcePath(),
		symbols: {
			shim_surface_live: { args: [], returns: I32 },
			shim_surface_reserve: { args: [P], returns: I32 },
			shim_surface_index: { args: [P], returns: I32 },
			shim_surface_hwnd: { args: [I32], returns: P },
			shim_surface_ctrl: { args: [I32], returns: P },
			shim_surface_web: { args: [I32], returns: P },
			shim_surface_set_ctrl: { args: [I32, P], returns: I32 },
			shim_surface_set_web: { args: [I32, P], returns: I32 },
			shim_surface_set_hr: { args: [I32, I32, I32], returns: I32 },
			shim_surface_hr: { args: [I32, I32], returns: I32 },
			shim_surface_url: { args: [I32], returns: P },
			shim_surface_set_bounds: {
				args: [I32, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
				returns: I32,
			},
			shim_surface_bound: { args: [I32, I32], returns: FFIType.f64 },
			shim_surface_release: { args: [I32], returns: FFIType.void },
		},
	}).symbols;
}

const shim = unit();
/** A handle per test, so one test's release cannot free another's surface. */
let hwnd = 0x1000;
const fresh = (): { handle: number; hwnd: number } => {
	hwnd += 0x10;
	const value = shim.shim_surface_reserve(BigInt(hwnd));
	expect(value).toBeGreaterThanOrEqual(0);
	return { handle: Number(value), hwnd };
};

describe("the surface table", () => {
	test("reserve hands out entry 0 first, so the app window is handle 0", () => {
		const first = shim.shim_surface_reserve(0x9000n);
		expect(Number(first)).toBe(0);
		expect(Number(shim.shim_surface_index(0x9000n))).toBe(0);
		expect(Number(shim.shim_surface_hwnd(0))).toBe(0x9000);
		shim.shim_surface_release(0);
	});

	test("two handles keep separate webview, HRESULT and bounds state", () => {
		const a = fresh();
		const b = fresh();
		expect(a.handle).not.toBe(b.handle);
		expect(Number(shim.shim_surface_set_ctrl(a.handle, 0xa1n))).toBe(1);
		expect(Number(shim.shim_surface_set_ctrl(b.handle, 0xb1n))).toBe(1);
		expect(Number(shim.shim_surface_set_web(a.handle, 0xa2n))).toBe(1);
		expect(Number(shim.shim_surface_set_web(b.handle, 0xb2n))).toBe(1);

		expect(Number(shim.shim_surface_web(a.handle))).toBe(0xa2);
		expect(Number(shim.shim_surface_web(b.handle))).toBe(0xb2);
		expect(Number(shim.shim_surface_ctrl(a.handle))).toBe(0xa1);
		expect(Number(shim.shim_surface_ctrl(b.handle))).toBe(0xb1);

		// One surface's refusal is not the other's success: the HRESULTs are per handle.
		expect(Number(shim.shim_surface_set_hr(a.handle, 1, -2147467259))).toBe(1);
		expect(Number(shim.shim_surface_set_hr(b.handle, 1, 0))).toBe(1);
		expect(Number(shim.shim_surface_hr(a.handle, 1))).toBe(-2147467259);
		expect(Number(shim.shim_surface_hr(b.handle, 1))).toBe(0);

		// A positioned surface and a full-bleed one, which is the per-controller bounds claim.
		expect(Number(shim.shim_surface_set_bounds(a.handle, 0, 0, 320, 240))).toBe(1);
		expect(Number(shim.shim_surface_set_bounds(b.handle, 24, 16, 200, 120))).toBe(1);
		expect([0, 1, 2, 3].map((which) => shim.shim_surface_bound(a.handle, which))).toEqual([
			0, 0, 320, 240,
		]);
		expect([0, 1, 2, 3].map((which) => shim.shim_surface_bound(b.handle, which))).toEqual([
			24, 16, 200, 120,
		]);

		// Each surface owns its Navigate buffer: sharing one would let the second navigation rewrite
		// the bytes the first surface is still about to hand WebView2.
		const urlA = Number(shim.shim_surface_url(a.handle));
		const urlB = Number(shim.shim_surface_url(b.handle));
		expect(urlA).toBeGreaterThan(0);
		expect(urlB).toBeGreaterThan(0);
		expect(urlA).not.toBe(urlB);

		shim.shim_surface_release(a.handle);
		shim.shim_surface_release(b.handle);
	});

	test("a released handle never names the surface that reused the slot", () => {
		const a = fresh();
		const b = fresh();
		shim.shim_surface_release(a.handle);
		expect(Number(shim.shim_surface_index(BigInt(a.hwnd)))).toBe(-1);
		expect(Number(shim.shim_surface_web(a.handle))).toBe(0);
		// The slot is reused — that is what keeps eight failed creates from ending window creation —
		// and the handle that comes back is the same index, naming a different window.
		const reused = shim.shim_surface_reserve(0x7000n);
		expect(Number(reused)).toBe(a.handle);
		expect(Number(shim.shim_surface_hwnd(reused))).toBe(0x7000);
		// The other surface is untouched by any of it.
		expect(Number(shim.shim_surface_hwnd(b.handle))).toBe(b.hwnd);
		shim.shim_surface_release(reused);
		shim.shim_surface_release(b.handle);
	});

	test("an out-of-range handle answers a refusal, not a neighbouring surface", () => {
		const live = fresh();
		for (const handle of [-1, 8, 99]) {
			expect(Number(shim.shim_surface_web(handle))).toBe(0);
			expect(Number(shim.shim_surface_ctrl(handle))).toBe(0);
			expect(Number(shim.shim_surface_url(handle))).toBe(0);
			expect(Number(shim.shim_surface_hr(handle, 0))).toBe(0);
			expect(Number(shim.shim_surface_bound(handle, 2))).toBe(0);
			// A write through a bad handle is refused rather than landing on entry 0.
			expect(Number(shim.shim_surface_set_web(handle, 0xdeadn))).toBe(0);
			expect(Number(shim.shim_surface_set_hr(handle, 0, 1))).toBe(0);
		}
		expect(Number(shim.shim_surface_web(live.handle))).toBe(0);
		shim.shim_surface_release(live.handle);
	});

	test("the live count and a double release", () => {
		const a = fresh();
		const b = fresh();
		const live = Number(shim.shim_surface_live());
		shim.shim_surface_release(a.handle);
		expect(Number(shim.shim_surface_live())).toBe(live - 1);
		// A title-bar close and a failed create can both release the same slot; the second is a no-op.
		shim.shim_surface_release(a.handle);
		expect(Number(shim.shim_surface_live())).toBe(live - 1);
		shim.shim_surface_release(b.handle);
	});

	test("the file the shim compiles is the file this test compiled", () => {
		const parts = [...SHIM_PART_NAMES];
		expect(parts).toContain("41_surfaces.c");
		// Before both halves that use it: the table has to precede the calls that index it.
		expect(parts.indexOf("41_surfaces.c")).toBeLessThan(parts.indexOf("42_webview.c"));
		expect(parts.indexOf("41_surfaces.c")).toBeLessThan(parts.indexOf("43_webview_calls.c"));
	});
});
