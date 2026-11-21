/**
 * The callback and the object it produces: the 32-bit HRESULT that must not be read as 64, whether the
 * environment completion fired inside its own call, the two halves of the attach, and the three answers
 * an apartment read can give. Split from `handler.test.ts` when the file outgrew the line cap.
 */
import { describe, expect, test } from "bun:test";
import { readShimPart, readShimSource } from "./shim-source.ts";

const source = readShimSource();
const env = readShimPart("32_env.c");
const com = readShimPart("30_com.c");

describe("the callback's HRESULT is 32 bits, all the way in", () => {
	/**
	 * `Invoke`'s second argument is a 32-bit HRESULT: the caller sets EDX only, so a 64-bit parameter
	 * stores an undefined top half of RDX. `code == 0` then reads an `S_OK` environment as a failure —
	 * which silently skips the nested controller creation and brings `UI_E_WRONG_THREAD` back on some
	 * runs and not others.
	 */
	test("handler_invoke takes int, and the handler stores int", () => {
		expect(com).toContain(
			"static shim_i64 handler_invoke(void *self, int code, void *created)",
		);
		expect(com).not.toContain("handler_invoke(void *self, shim_i64 code");
		expect(com).toContain("\tint failed;");
	});

	/** The export boundary is where it widens, so a sign test on the JavaScript side is honest. */
	test("the callback exports widen from int at the boundary", () => {
		expect(env).toContain(
			"shim_i64 shim_env_callback(void) { return (shim_i64)g_env_handler.failed; }",
		);
		expect(env).toContain(
			"shim_i64 shim_controller_callback(void) { return (shim_i64)g_ctrl_handler.failed; }",
		);
	});
});

describe("the reentrancy measurement", () => {
	/**
	 * Measured on the runner: `env_begin` took 643 ms and `env_wait` returned in 0.098 ms, so the
	 * environment completion fired inside `create_env` — on that call's own stack. WebView2 calls a
	 * nested loop inside a handler unsupported, so whether the controller was built re-entrantly is
	 * printed before anything is built on it.
	 */
	test("records whether the callback fired inside create_env", () => {
		expect(source).toContain("int shim_env_inline(void)");
		expect(env).toContain("g_env_inline = g_env_handler.done;");
		const call = env.indexOf("g_env_hresult = create_env(");
		const flag = env.indexOf("g_env_inline = g_env_handler.done;");
		expect(call).toBeGreaterThan(-1);
		expect(flag).toBeGreaterThan(call);
	});
});

describe("the attach is two steps, so a fault names one", () => {
	test("get_CoreWebView2 and put_Bounds are separately callable and separately recorded", () => {
		expect(source).toContain("int shim_webview_bind(shim_h hwnd)");
		expect(source).toContain("int shim_webview_size(shim_h hwnd)");
		// The report takes the surface handle as well: two surfaces answer two different HRESULTs.
		expect(source).toContain("shim_i64 shim_attach_hresult(int handle, int which)");
		expect(source).toContain(
			"int shim_webview_attach(shim_h hwnd) {\n\tif (!shim_webview_bind(hwnd))",
		);
		// put_Bounds returns the method's own HRESULT, not a constant, so a refusal is distinguishable.
		expect(source).toContain(
			"return ((int (*)(void *, shim_rect *))vt[SHIM_SLOT_CONTROLLER_PUT_BOUNDS])",
		);
	});
});

describe("the apartment probe distinguishes its three answers", () => {
	test("binding, HRESULT and type are three separate reads", () => {
		expect(source).toContain("int shim_apartment_bound(void)");
		expect(source).toContain("shim_i64 shim_apartment_hresult(void)");
		expect(source).toContain("int shim_apartment_type(void)");
		// `CoGetApartmentType` returns a 32-bit HRESULT; declaring it wide is the trap this file fixes.
		expect(source).toContain("static int (*CoGetApartmentType)");
		expect(source).not.toContain("static shim_i64 (*CoGetApartmentType)");
	});
});
