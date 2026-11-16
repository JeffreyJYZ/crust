/**
 * The hand-built COM handler: its layout, its table, and the frame that is allowed to call WebView2
 * from it. None of this can be executed on a Mac, so it is read out of the unit's own source.
 *
 * Two defects came from here and both were silent: a table of code addresses in a static initialiser
 * (the first callback jumped to `0xFFFFFFFFFFFFFFFF`), and a controller created one frame after the
 * environment completion (WebView2 answered `UI_E_WRONG_THREAD`, 0x802A000C).
 */
import { describe, expect, test } from "bun:test";
import { readShimPart, readShimSource } from "./shim-source.ts";

const source = readShimSource();
const env = readShimPart("32_env.c");
const com = readShimPart("30_com.c");

describe("the handler vtable", () => {
	test("is not a static initialiser, because that pointer is relocated by the image", () => {
		expect(source).not.toMatch(/handler_vtbl\[4\]\s*=\s*\{/);
		expect(source).not.toMatch(/=\s*\{\s*\(void \*\)handler_/);
	});

	test("is assigned entry by entry, once, before the first COM call", () => {
		for (const [index, name] of [
			"handler_qi",
			"handler_addref",
			"handler_release",
			"handler_invoke",
		].entries()) {
			expect(source).toContain(`g_handler_vtbl[${index}] = (void *)${name};`);
		}
		expect(source).toContain("void handler_init(shim_handler *h, int step) {");
		expect(source).toContain("handler_init(&g_env_handler, SHIM_THREAD_ENV_CALLBACK)");
	});

	/**
	 * QueryInterface answers every IID, so WebView2 is told this object supports interfaces it does
	 * not have. A call to one of those must land on a refusal, not on whatever follows the table.
	 */
	test("pads every slot past Invoke with a refusal", () => {
		expect(source).toContain("#define SHIM_HANDLER_SLOTS 8");
		expect(source).toMatch(/for \(slot = 4; slot < SHIM_HANDLER_SLOTS; slot\+\+\)/);
		expect(source).toContain("g_handler_vtbl[slot] = (void *)handler_unsupported;");
		expect(source).toContain("return -2147467262LL; /* E_NOINTERFACE */");
	});

	/** The readback the probe prints, so a wrong layout is a number instead of a guess. */
	test("can be read back, the way Windows reads it", () => {
		expect(source).toContain("shim_i64 shim_handler_vtbl_addr(void)");
		expect(source).toContain("shim_i64 shim_handler_entry(int index)");
		expect(source).toContain("shim_i64 shim_handler_first_field(void)");
		expect(source).toContain("int shim_handler_prepare(void)");
	});

	/** HRESULT is 32 bits; a 64-bit declaration leaves the top half of RAX undefined. */
	test("every vtable call is declared to return int, not shim_i64", () => {
		expect(source).not.toMatch(/\(shim_i64 \(\*\)\(void \*, shim_rect \*\)\)/);
		expect(source).not.toMatch(/\(shim_i64 \(\*\)\(void \*\)\)vt\[/);
		expect(source).toContain(
			"int wv2_env_create_controller(void *env, shim_h hwnd, void *handler)",
		);
	});
});

describe("the thread bookkeeping", () => {
	/**
	 * `CreateCoreWebView2Controller` answered UI_E_WRONG_THREAD (0x802A000C) while the environment call
	 * on the same path succeeded, so which thread each step ran on is the measurement.
	 */
	test("records a thread for every step that can be blamed", () => {
		for (const step of [
			"SHIM_THREAD_COM",
			"SHIM_THREAD_ENV_CALL",
			"SHIM_THREAD_ENV_CALLBACK",
			"SHIM_THREAD_CTRL_CALL",
			"SHIM_THREAD_CTRL_CALLBACK",
		]) {
			expect(source).toContain(`#define ${step} `);
		}
		expect(source).toContain("shim_note_thread(SHIM_THREAD_COM);");
		expect(source).toContain("shim_note_thread(SHIM_THREAD_ENV_CALL);");
		expect(source).toContain("shim_note_thread(SHIM_THREAD_CTRL_CALL);");
		expect(source).toContain("shim_note_thread(h->step);");
		expect(source).toContain("handler_init(&g_env_handler, SHIM_THREAD_ENV_CALLBACK);");
		expect(source).toContain("handler_init(&g_ctrl_handler, SHIM_THREAD_CTRL_CALLBACK);");
	});

	test("affinity is readable: the window's thread and this thread's apartment", () => {
		expect(source).toContain("int shim_window_thread(shim_h hwnd)");
		expect(source).toContain("int shim_apartment_type(void)");
		expect(source).toContain("SHIM_BIND(g_user32, GetWindowThreadProcessId);");
		expect(source).toContain("SHIM_BIND(g_ole32, CoGetApartmentType);");
	});
});

describe("the controller is created inside the environment callback", () => {
	/**
	 * WebView2 objects are affine to the frame that created them: the identical
	 * `CreateCoreWebView2Controller` one frame later answers UI_E_WRONG_THREAD. Three of the five hosts
	 * compared for this (gosx, go-webview2, webview) do it the same way, and doing it here also means
	 * the call happens inside the `handler_wait` drain, so the thread is pumping at that moment.
	 */
	test("the callback records the request, and the call is deferred out of it", () => {
		expect(com).toContain("h->step == SHIM_THREAD_ENV_CALLBACK && code == 0 && h->result");
		expect(com).toContain("shim_controller_from_callback(h->result);");
		// The callback itself must not call into WebView2: that is the reentrant shape that produced a
		// half-built object (first dword 0xffffffff where the vtable belongs).
		const callback = env.slice(
			env.indexOf("void shim_controller_from_callback(void *env) {"),
			env.indexOf("\n}", env.indexOf("void shim_controller_from_callback(void *env) {")),
		);
		expect(callback).not.toContain("wv2_env_create_controller");
		expect(callback).toContain("g_ctrl_pending = 1;");
		// One statement later, still inside the same C call.
		expect(env).toContain("static void shim_controller_deferred(int from) {");
		expect(env).toContain("shim_controller_deferred(2);");
		expect(env).toContain("shim_controller_deferred(3);");
		expect(env).toContain("int shim_ctrl_from(void)");
	});

	test("the deferral happens after create_env returns, and after the pump", () => {
		const begin = env.slice(env.indexOf("shim_i64 shim_env_begin("));
		expect(begin.indexOf("shim_controller_deferred(2);")).toBeGreaterThan(
			begin.indexOf("g_env_hresult = create_env("),
		);
		const wait = env.slice(env.indexOf("int shim_env_wait(void) {"));
		expect(wait.indexOf("shim_controller_deferred(3);")).toBeGreaterThan(
			wait.indexOf("handler_wait(&g_env_handler, 5000);"),
		);
	});

	/** `done` is set before the nested call, so a slow WebView2 call cannot keep the env wait spinning. */
	test("the callback marks itself done before it creates the controller", () => {
		const body = com.slice(com.indexOf("static shim_i64 handler_invoke("));
		const done = body.indexOf("h->done = 1;");
		const nested = body.indexOf("shim_controller_from_callback(h->result);");
		expect(done).toBeGreaterThan(-1);
		expect(nested).toBeGreaterThan(-1);
		expect(done).toBeLessThan(nested);
	});

	/** A `handler_init` after its own callback fired would reset refs and `done` under it. */
	test("both handlers are initialised before the environment call starts", () => {
		const start = env.indexOf("shim_i64 shim_env_begin(");
		expect(start).toBeGreaterThan(-1);
		const body = env.slice(start, env.indexOf("\n}", start));
		const init = body.indexOf("handler_init(&g_ctrl_handler, SHIM_THREAD_CTRL_CALLBACK);");
		const call = body.indexOf("g_env_hresult = create_env(");
		expect(init).toBeGreaterThan(-1);
		expect(call).toBeGreaterThan(-1);
		expect(init).toBeLessThan(call);
	});

	/** The window must be known before the callback fires, and the fallback must not repeat the call. */
	test("the window is recorded before the call, and nothing is created twice", () => {
		expect(env).toContain("shim_i64 shim_env_begin(shim_h hwnd, const char *userData)");
		expect(env).toContain("g_ctrl_hwnd = hwnd;");
		expect(env).toContain(
			"if (g_ctrl_requested && g_ctrl_hwnd == hwnd) return g_ctrl_hresult;",
		);
		expect(env).toContain("if (!g_ctrl_hwnd || g_ctrl_requested) return;");
		expect(env).toContain(
			"if (!g_ctrl_pending || g_ctrl_requested || !g_env_handler.result) return;",
		);
	});
});
